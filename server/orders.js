// 第二期：訂單（銷售價格依客戶與訂單而定，NTD，不開電子發票）
import ExcelJS from 'exceljs';
import { audit } from './db.js';
import { clean } from './importer.js';
import { latestPrice } from './search.js';
import { h, bad, notFound, today, intOrNull, HttpError, wineIdsFrom, readSettings, locationLabel } from './m2.js';

const STATUS = { draft: '草稿', confirmed: '已確認', shipped: '已出貨', cancelled: '已取消' };
const lineAmount = (l) => Math.round((l.qty || 0) * (l.unit_price || 0) * (1 - (l.discount || 0) / 100));
export function totals(o, lines) {
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const tax = Math.round(subtotal * (o.tax_rate || 0) / 100);
  return { subtotal, tax, shipping: o.shipping_fee || 0, total: subtotal + tax + (o.shipping_fee || 0), bottles: lines.reduce((s, l) => s + (l.qty || 0), 0) };
}

export function mountOrders(app, db) {
  const tx = (fn) => db.transaction(fn)();
  const U = (req) => req.user.login;
  const orderBy = (no) => db.prepare('SELECT * FROM orders WHERE order_no = ?').get(no) || notFound('找不到訂單 ' + no);
  const draftOnly = (o) => { if (o.status !== 'draft') bad(`訂單${STATUS[o.status]}，不能修改。要修改請先「改回草稿」。`); };
  const log = (req, o, action, changes, reason) => audit(db, { user: U(req), category: '銷售', action, obj_type: 'order', obj_id: o.order_no,
    obj_label: db.prepare('SELECT name FROM customers WHERE id = ?').get(o.customer_id)?.name || '（未指定客戶）', changes: changes || null, reason: reason || null });

  function newOrderNo() {
    const d = today().replace(/-/g, '');
    const n = db.prepare("SELECT COUNT(*) c FROM orders WHERE order_no LIKE ?").get(`SO-${d}-%`).c + 1;
    return `SO-${d}-${String(n).padStart(3, '0')}`;
  }
  // 預設單價：這位客戶上次成交價 → 建議售價
  function defaultPrice(wineId, customerId) {
    const last = customerId && db.prepare(`SELECT l.unit_price FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.wine_id = ? AND o.customer_id = ? AND o.status IN ('confirmed','shipped') AND l.unit_price IS NOT NULL ORDER BY o.order_date DESC, o.id DESC LIMIT 1`).get(wineId, customerId);
    if (last) return last.unit_price;
    const sug = db.prepare('SELECT suggested_price FROM wines WHERE id = ?').get(wineId)?.suggested_price;
    if (sug != null) return sug;
    // 都沒有：用最新市場價格（可在查價設定加成 %）
    const mk = db.prepare('SELECT price FROM price_history WHERE wine_id = ? AND voided = 0 ORDER BY effective_date DESC, id DESC LIMIT 1').get(wineId)?.price;
    if (mk == null) return null;
    const markup = Number(readSettings(db).price.order_markup) || 0;
    return Math.round(mk * (1 + markup / 100));
  }
  // 單價來源標示
  function priceSource(l, last) {
    if (l.unit_price == null) return null;
    if (last && last.p === l.unit_price) return 'last';
    if (l.suggested_price != null && l.suggested_price === l.unit_price) return 'suggested';
    const markup = Number(readSettings(db).price.order_markup) || 0;
    if (l.market != null && Math.round(l.market * (1 + markup / 100)) === l.unit_price) return 'market';
    return 'manual';
  }

  function detail(o) {
    const lines = db.prepare(`SELECT l.*, w.wine_no, w.winery, w.name, w.vintage, w.volume_ml, w.suggested_price, t.zh type_zh, t.en type_en, ${latestPrice} market
      FROM order_lines l JOIN wines w ON w.id = l.wine_id LEFT JOIN wine_types t ON t.code = w.type_code WHERE l.order_id = ? ORDER BY l.pos, l.id`).all(o.id);
    for (const l of lines) {
      l.amount = lineAmount(l);
      l.available = db.prepare("SELECT COUNT(*) n FROM bottles WHERE wine_id = ? AND status = 'in_stock'").get(l.wine_id).n;
      l.held = db.prepare('SELECT b.bottle_no, ob.state, c.case_no, b.rack_id FROM order_bottles ob JOIN bottles b ON b.id = ob.bottle_id LEFT JOIN cases c ON c.id = b.case_id WHERE ob.line_id = ? ORDER BY c.case_no, b.bottle_no').all(l.id)
        .map((b) => ({ ...b, location: locationLabel(db, b.rack_id) }));
      l.locations = db.prepare(`SELECT c.case_no, b.rack_id, COUNT(*) n FROM bottles b LEFT JOIN cases c ON c.id = b.case_id WHERE b.wine_id = ? AND b.status = 'in_stock' GROUP BY b.case_id, b.rack_id ORDER BY n DESC LIMIT 4`).all(l.wine_id)
        .map((x) => ({ ...x, location: locationLabel(db, x.rack_id) }));
      const costBase = l.held.length ? `b.id IN (SELECT bottle_id FROM order_bottles WHERE line_id = ${l.id})` : `b.wine_id = ${l.wine_id} AND b.status = 'in_stock'`;
      l.cost = db.prepare(`SELECT ROUND(AVG(lot.purchase_price)) c FROM bottles b JOIN lots lot ON lot.id = b.lot_id WHERE ${costBase} AND lot.purchase_price IS NOT NULL`).get().c;
      l.last_price = o.customer_id ? db.prepare(`SELECT l2.unit_price p, o2.order_date d FROM order_lines l2 JOIN orders o2 ON o2.id = l2.order_id WHERE l2.wine_id = ? AND o2.customer_id = ? AND o2.id <> ? AND o2.status IN ('confirmed','shipped') ORDER BY o2.order_date DESC, o2.id DESC LIMIT 1`).get(l.wine_id, o.customer_id, o.id) || null : null;
      l.price_source = priceSource(l, l.last_price);
    }
    const t = totals(o, lines);
    const costTotal = lines.reduce((s, l) => s + (l.cost || 0) * l.qty, 0);
    const customer = o.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(o.customer_id) : null;
    const addresses = o.customer_id ? db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, id').all(o.customer_id) : [];
    const logs = db.prepare("SELECT ts, user_login, category, action, obj_label, changes, reason FROM audit_log WHERE obj_type = 'order' AND obj_id = ? ORDER BY id DESC").all(o.order_no);
    const list = o.from_list_id ? db.prepare('SELECT id, name FROM lists WHERE id = ?').get(o.from_list_id) : null;
    return { order: o, lines, totals: t, cost: costTotal, margin: t.subtotal - costTotal, customer, addresses, logs, list, company: readSettings(db).company, markup: Number(readSettings(db).price.order_markup) || 0 };
  }

  app.get('/api/orders', h((req) => {
    const q = req.query;
    const where = ['1=1'], p = {};
    if (q.status) { p.status = q.status; where.push('o.status = @status'); }
    if (q.customer) { p.customer = Number(q.customer); where.push('o.customer_id = @customer'); }
    if (q.q) { p.q = '%' + clean(q.q) + '%'; where.push('(o.order_no LIKE @q OR c.name LIKE @q OR o.note LIKE @q)'); }
    const rows = db.prepare(`SELECT o.*, c.name customer FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE ${where.join(' AND ')} ORDER BY o.order_date DESC, o.id DESC LIMIT 300`).all(p)
      .map((o) => ({ ...o, ...totals(o, db.prepare('SELECT qty, unit_price, discount FROM order_lines WHERE order_id = ?').all(o.id)) }));
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
    return { rows, counts };
  }));
  app.get('/api/orders/:no', h((req) => detail(orderBy(req.params.no))));

  app.post('/api/orders', h((req) => tx(() => {
    const b = req.body || {};
    const cust = b.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(b.customer_id)) || bad('找不到客戶') : null;
    let ids = [];
    if (b.list_id) ids = db.prepare('SELECT wine_id FROM list_items WHERE list_id = ? ORDER BY pos, id').all(Number(b.list_id)).map((r) => r.wine_id);
    else if (b.wine_nos || b.codes || b.query) ids = wineIdsFrom(db, b);
    const addr = cust ? db.prepare('SELECT address FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, id LIMIT 1').get(cust.id)?.address || cust.address : null;
    const no = newOrderNo();
    const taxRate = Number(readSettings(db).company.tax_rate ?? 5);
    const id = db.prepare(`INSERT INTO orders (order_no, customer_id, order_date, lang, address, tax_rate, from_list_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(no, cust?.id ?? null, today(), cust?.lang || 'zh', addr || null, Number.isFinite(taxRate) ? taxRate : 5, b.list_id ? Number(b.list_id) : null, U(req)).lastInsertRowid;
    const ins = db.prepare('INSERT INTO order_lines (order_id, wine_id, qty, unit_price, discount, pos) VALUES (?, ?, ?, ?, ?, ?)');
    ids.forEach((wid, i) => ins.run(id, wid, 1, defaultPrice(wid, cust?.id), cust?.discount || 0, i + 1));
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    log(req, o, '建立訂單', { 酒款: ids.length, ...(b.list_id ? { 來源清單: db.prepare('SELECT name FROM lists WHERE id = ?').get(Number(b.list_id))?.name } : {}) });
    return { order_no: no };
  })));

  app.put('/api/orders/:no', h((req) => tx(() => {
    const o = orderBy(req.params.no);
    draftOnly(o);
    const b = req.body || {};
    const changes = {};
    const next = { ...o };
    if ('customer_id' in b) { const v = b.customer_id ? Number(b.customer_id) : null; if (v && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(v)) bad('找不到客戶'); if (v !== o.customer_id) { changes['客戶'] = [db.prepare('SELECT name FROM customers WHERE id = ?').get(o.customer_id)?.name ?? null, db.prepare('SELECT name FROM customers WHERE id = ?').get(v)?.name ?? null]; next.customer_id = v; } }
    for (const [k, l] of [['order_date', '訂單日期'], ['delivery_date', '預計交貨日'], ['address', '送貨地址'], ['note', '備註']]) if (k in b) { const v = clean(b[k]) || null; if ((o[k] ?? null) !== v) { changes[l] = [o[k], v]; next[k] = v; } }
    if (next.order_date && !/^\d{4}-\d\d-\d\d$/.test(next.order_date)) bad('訂單日期格式需為 YYYY-MM-DD');
    if (!next.order_date) bad('請填寫訂單日期');
    if ('lang' in b) { const v = b.lang === 'en' ? 'en' : 'zh'; if (v !== o.lang) { changes['文件語言'] = [o.lang, v]; next.lang = v; } }
    if ('shipping_fee' in b) { const v = intOrNull(b.shipping_fee) ?? 0; if (v < 0) bad('運費不正確'); if (v !== o.shipping_fee) { changes['運費'] = [o.shipping_fee, v]; next.shipping_fee = v; } }
    if ('tax_rate' in b) { const v = Number(b.tax_rate); if (!(v >= 0 && v <= 100)) bad('稅率不正確'); if (v !== o.tax_rate) { changes['稅率'] = [o.tax_rate, v]; next.tax_rate = v; } }
    db.prepare(`UPDATE orders SET customer_id = @customer_id, order_date = @order_date, delivery_date = @delivery_date, lang = @lang, address = @address, note = @note,
      shipping_fee = @shipping_fee, tax_rate = @tax_rate, updated_at = datetime('now','localtime') WHERE id = @id`).run(next);
    if (Array.isArray(b.lines)) {
      const old = db.prepare('SELECT l.*, w.wine_no FROM order_lines l JOIN wines w ON w.id = l.wine_id WHERE order_id = ?').all(o.id);
      const keep = new Set();
      const seen = new Set();
      b.lines.forEach((x, i) => {
        const w = db.prepare('SELECT id, name, vintage FROM wines WHERE wine_no = ?').get(x.wine_no) || bad('找不到酒款 ' + x.wine_no);
        if (seen.has(w.id)) bad(`${w.name} 重複了，請合併成一行`);
        seen.add(w.id);
        const qty = intOrNull(x.qty);
        if (!qty || qty < 1) bad(`${w.name}：數量至少 1`);
        const price = intOrNull(x.unit_price);
        if (price != null && price < 0) bad(`${w.name}：單價不正確`);
        const disc = x.discount === '' || x.discount == null ? 0 : Number(x.discount);
        if (!(disc >= 0 && disc <= 100)) bad(`${w.name}：折扣需為 0–100%`);
        const prev = old.find((l) => l.wine_id === w.id);
        if (prev) {
          keep.add(prev.id);
          if (prev.qty !== qty || prev.unit_price !== price || prev.discount !== disc) {
            changes[`${w.name} ${w.vintage}`] = `${prev.qty}×${prev.unit_price ?? '—'}${prev.discount ? ` -${prev.discount}%` : ''} → ${qty}×${price ?? '—'}${disc ? ` -${disc}%` : ''}`;
          }
          db.prepare('UPDATE order_lines SET qty = ?, unit_price = ?, discount = ?, pos = ? WHERE id = ?').run(qty, price, disc, i + 1, prev.id);
        } else {
          db.prepare('INSERT INTO order_lines (order_id, wine_id, qty, unit_price, discount, pos) VALUES (?, ?, ?, ?, ?, ?)').run(o.id, w.id, qty, price ?? defaultPrice(w.id, next.customer_id), x.discount == null ? (db.prepare('SELECT discount FROM customers WHERE id = ?').get(next.customer_id)?.discount || 0) : disc, i + 1);
          changes[`${w.name} ${w.vintage}`] = `新增 ${qty} 瓶`;
        }
      });
      for (const l of old) if (!keep.has(l.id)) { db.prepare('DELETE FROM order_lines WHERE id = ?').run(l.id); const w = db.prepare('SELECT name, vintage FROM wines WHERE id = ?').get(l.wine_id); changes[`${w.name} ${w.vintage}`] = '移除'; }
    }
    if (Object.keys(changes).length) log(req, next, '修改訂單', changes);
    return detail(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id));
  })));

  app.post('/api/orders/:no/lines', h((req) => tx(() => {
    const o = orderBy(req.params.no); draftOnly(o);
    const ids = wineIdsFrom(db, req.body || {});
    const have = new Set(db.prepare('SELECT wine_id FROM order_lines WHERE order_id = ?').all(o.id).map((r) => r.wine_id));
    const max = db.prepare('SELECT COALESCE(MAX(pos), 0) m FROM order_lines WHERE order_id = ?').get(o.id).m;
    const disc = db.prepare('SELECT discount FROM customers WHERE id = ?').get(o.customer_id)?.discount || 0;
    let n = 0;
    for (const wid of ids) if (!have.has(wid)) { db.prepare('INSERT INTO order_lines (order_id, wine_id, qty, unit_price, discount, pos) VALUES (?, ?, 1, ?, ?, ?)').run(o.id, wid, defaultPrice(wid, o.customer_id), disc, max + ++n); }
    if (n) log(req, o, '修改訂單', { 加入酒款: n });
    return { added: n };
  })));

  // 確認：依位置挑選瓶號並保留（優先清空零散的酒箱）
  app.post('/api/orders/:no/confirm', h((req) => tx(() => {
    const o = orderBy(req.params.no); draftOnly(o);
    if (!o.customer_id) bad('請先選擇客戶');
    const lines = db.prepare('SELECT l.*, w.name, w.vintage FROM order_lines l JOIN wines w ON w.id = l.wine_id WHERE order_id = ?').all(o.id);
    if (!lines.length) bad('訂單沒有酒款');
    const noPrice = lines.filter((l) => l.unit_price == null);
    if (noPrice.length) bad('請填寫單價：' + noPrice.map((l) => l.name).join('、'));
    const short = [];
    let held = 0;
    for (const l of lines) {
      const cands = db.prepare(`SELECT b.id, b.bottle_no, b.case_id, (SELECT COUNT(*) FROM bottles x WHERE x.case_id = b.case_id AND x.status = 'in_stock') case_n
        FROM bottles b LEFT JOIN cases c ON c.id = b.case_id WHERE b.wine_id = ? AND b.status = 'in_stock' ORDER BY CASE WHEN b.case_id IS NULL THEN 0 ELSE 1 END, case_n, c.case_no, b.bottle_no`).all(l.wine_id);
      if (cands.length < l.qty) { short.push(`${l.name} ${l.vintage}：要 ${l.qty} 瓶，可用 ${cands.length} 瓶`); continue; }
      for (const b of cands.slice(0, l.qty)) {
        db.prepare("UPDATE bottles SET status = 'reserved' WHERE id = ?").run(b.id);
        db.prepare("INSERT INTO order_bottles (order_id, line_id, bottle_id, state) VALUES (?, ?, ?, 'reserved')").run(o.id, l.id, b.id);
        held++;
      }
    }
    if (short.length) throw new HttpError(400, '庫存不足：' + short.join('；'));
    db.prepare("UPDATE orders SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now','localtime') WHERE id = ?").run(U(req), o.id);
    const t = totals(o, lines);
    log(req, o, '確認訂單', { 保留瓶數: held, 總金額: t.total });
    return detail(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id));
  })));

  function release(o) {
    const held = db.prepare("SELECT bottle_id FROM order_bottles WHERE order_id = ? AND state = 'reserved'").all(o.id);
    for (const r of held) db.prepare("UPDATE bottles SET status = 'in_stock' WHERE id = ? AND status = 'reserved'").run(r.bottle_id);
    db.prepare("DELETE FROM order_bottles WHERE order_id = ? AND state = 'reserved'").run(o.id);
    return held.length;
  }
  app.post('/api/orders/:no/unconfirm', h((req) => tx(() => {
    const o = orderBy(req.params.no);
    if (o.status !== 'confirmed') bad('只有已確認的訂單可以改回草稿');
    const n = release(o);
    db.prepare("UPDATE orders SET status = 'draft', confirmed_by = NULL, confirmed_at = NULL WHERE id = ?").run(o.id);
    log(req, o, '改回草稿', { 釋放保留: n });
    return detail(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id));
  })));
  app.post('/api/orders/:no/cancel', h((req) => tx(() => {
    const o = orderBy(req.params.no);
    if (o.status === 'shipped' || o.status === 'cancelled') bad(`訂單${STATUS[o.status]}，不能取消`);
    const reason = clean(req.body?.reason) || bad('請填寫取消原因');
    const n = release(o);
    db.prepare("UPDATE orders SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now','localtime'), cancel_reason = ? WHERE id = ?").run(U(req), reason, o.id);
    log(req, o, '取消訂單', n ? { 釋放保留: n } : null, reason);
    return detail(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id));
  })));

  // 出貨：掃描實際拿出的瓶號；可以換成同款的其他在庫瓶；未掃的可選擇照保留的瓶號出貨
  app.post('/api/orders/:no/ship', h((req) => tx(() => {
    const o = orderBy(req.params.no);
    if (o.status !== 'confirmed') bad('只有已確認的訂單可以出貨');
    const { bottle_nos = [], use_reserved = false } = req.body || {};
    const lines = db.prepare('SELECT l.*, w.name, w.vintage, w.wine_no FROM order_lines l JOIN wines w ON w.id = l.wine_id WHERE order_id = ?').all(o.id);
    const byWine = new Map(lines.map((l) => [l.wine_id, { line: l, reserved: db.prepare("SELECT bottle_id FROM order_bottles WHERE line_id = ? AND state = 'reserved'").all(l.id).map((r) => r.bottle_id), picked: [] }]));
    const errors = [];
    for (const raw of [...new Set(bottle_nos.map((x) => clean(x).toUpperCase()))]) {
      const b = db.prepare('SELECT b.*, ob.order_id held_by FROM bottles b LEFT JOIN order_bottles ob ON ob.bottle_id = b.id AND ob.state = \'reserved\' WHERE b.bottle_no = ?').get(raw);
      if (!b) { errors.push(`${raw}：找不到瓶號`); continue; }
      const g = byWine.get(b.wine_id);
      if (!g) { errors.push(`${raw}：不是這張訂單的酒款`); continue; }
      if (b.status === 'reserved' && b.held_by !== o.id) { errors.push(`${raw}：已被其他訂單保留`); continue; }
      if (b.status !== 'in_stock' && b.status !== 'reserved') { errors.push(`${raw}：狀態不是在庫`); continue; }
      if (g.picked.length >= g.line.qty) { errors.push(`${raw}：${g.line.name} 已掃滿 ${g.line.qty} 瓶`); continue; }
      g.picked.push(b.id);
    }
    if (errors.length) throw new HttpError(400, errors.join('；'));
    const missing = [];
    for (const g of byWine.values()) {
      const need = g.line.qty - g.picked.length;
      if (need > 0) {
        if (!use_reserved) { missing.push(`${g.line.name}：還差 ${need} 瓶`); continue; }
        const pool = g.reserved.filter((id) => !g.picked.includes(id));
        if (pool.length < need) { missing.push(`${g.line.name}：還差 ${need - pool.length} 瓶`); continue; }
        g.picked.push(...pool.slice(0, need));
      }
    }
    if (missing.length) throw new HttpError(400, '數量不足：' + missing.join('；'));
    let shipped = 0;
    for (const g of byWine.values()) {
      const pickedSet = new Set(g.picked);
      // 換掉的保留瓶放回在庫
      for (const id of g.reserved) if (!pickedSet.has(id)) { db.prepare("UPDATE bottles SET status = 'in_stock' WHERE id = ?").run(id); db.prepare('DELETE FROM order_bottles WHERE order_id = ? AND bottle_id = ?').run(o.id, id); }
      const nos = [];
      for (const id of g.picked) {
        const b = db.prepare('SELECT b.bottle_no, b.rack_id, c.case_no FROM bottles b LEFT JOIN cases c ON c.id = b.case_id WHERE b.id = ?').get(id);
        nos.push(b.bottle_no);
        db.prepare("UPDATE bottles SET status = 'shipped' WHERE id = ?").run(id);
        db.prepare("INSERT INTO order_bottles (order_id, line_id, bottle_id, state) VALUES (?, ?, ?, 'shipped') ON CONFLICT(order_id, bottle_id) DO UPDATE SET state = 'shipped', line_id = excluded.line_id").run(o.id, g.line.id, id);
        shipped++;
      }
      audit(db, { user: U(req), category: '銷售', action: '出貨', obj_type: 'wine', obj_id: g.line.wine_no, obj_label: `${g.line.name} ${g.line.vintage}`,
        changes: { 訂單: o.order_no, 瓶數: nos.length, 瓶號: nos.join(', '), 單價: g.line.unit_price, ...(g.line.discount ? { 折扣: g.line.discount + '%' } : {}) } });
    }
    db.prepare("UPDATE orders SET status = 'shipped', shipped_by = ?, shipped_at = datetime('now','localtime') WHERE id = ?").run(U(req), o.id);
    log(req, o, '出貨', { 瓶數: shipped, 總金額: totals(o, lines).total });
    return detail(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id));
  })));

  app.post('/api/orders/:no/copy', h((req) => tx(() => {
    const o = orderBy(req.params.no);
    const no = newOrderNo();
    const id = db.prepare(`INSERT INTO orders (order_no, customer_id, order_date, lang, address, tax_rate, shipping_fee, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(no, o.customer_id, today(), o.lang, o.address, o.tax_rate, o.shipping_fee, o.note, U(req)).lastInsertRowid;
    db.prepare('INSERT INTO order_lines (order_id, wine_id, qty, unit_price, discount, pos) SELECT ?, wine_id, qty, unit_price, discount, pos FROM order_lines WHERE order_id = ?').run(id, o.id);
    log(req, db.prepare('SELECT * FROM orders WHERE id = ?').get(id), '建立訂單', { 複製自: o.order_no });
    return { order_no: no };
  })));

  app.get('/api/orders-export', h(async (req, res) => {
    const where = req.query.status ? 'WHERE o.status = ?' : '';
    const rows = db.prepare(`SELECT o.*, c.name customer FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${where} ORDER BY o.order_date DESC, o.id DESC`).all(...(req.query.status ? [req.query.status] : []));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('訂單');
    const head = ws.addRow(['訂單編號', '日期', '客戶', '狀態', '瓶數', '小計（未稅）', '營業稅', '運費', '總金額（含稅）', '業務人員', '備註']);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2342' } }; });
    const ls = wb.addWorksheet('明細');
    const h2 = ls.addRow(['訂單編號', '日期', '客戶', '狀態', '酒款編號', '品名', '年份', '數量', '單價', '折扣 %', '小計']);
    h2.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h2.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2342' } }; });
    for (const o of rows) {
      const lines = db.prepare('SELECT l.*, w.wine_no, w.name, w.vintage FROM order_lines l JOIN wines w ON w.id = l.wine_id WHERE order_id = ? ORDER BY pos').all(o.id);
      const t = totals(o, lines);
      ws.addRow([o.order_no, o.order_date, o.customer, STATUS[o.status], t.bottles, t.subtotal, t.tax, t.shipping, t.total, o.created_by, o.note]);
      for (const l of lines) ls.addRow([o.order_no, o.order_date, o.customer, STATUS[o.status], l.wine_no, l.name, l.vintage, l.qty, l.unit_price, l.discount, lineAmount(l)]);
    }
    [14, 12, 24, 10, 8, 14, 10, 10, 16, 12, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    [14, 12, 20, 10, 12, 44, 8, 8, 12, 8, 12].forEach((w, i) => { ls.getColumn(i + 1).width = w; });
    for (const c of [6, 7, 8, 9]) ws.getColumn(c).numFmt = '#,##0';
    for (const c of [9, 11]) ls.getColumn(c).numFmt = '#,##0';
    audit(db, { user: U(req), category: '匯出', action: '匯出訂單 Excel', obj_type: 'order', obj_id: null, obj_label: req.query.status ? STATUS[req.query.status] : '全部', changes: { 筆數: rows.length } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="orders.xlsx"; filename*=UTF-8''${encodeURIComponent('訂單-' + today() + '.xlsx')}`);
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }));

  // ===== 客戶頁：歷史訂單與各酒款成交價 =====
  app.get('/api/customers/:id', h((req) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id)) || notFound('找不到客戶');
    const addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, id').all(c.id);
    const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY order_date DESC, id DESC').all(c.id)
      .map((o) => ({ ...o, ...totals(o, db.prepare('SELECT qty, unit_price, discount FROM order_lines WHERE order_id = ?').all(o.id)) }));
    const prices = db.prepare(`SELECT w.wine_no, w.name, w.vintage, o.order_no, o.order_date, o.status, l.qty, l.unit_price, l.discount FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN wines w ON w.id = l.wine_id
      WHERE o.customer_id = ? AND o.status IN ('confirmed','shipped') ORDER BY w.name, o.order_date DESC`).all(c.id);
    const spent = orders.filter((o) => o.status === 'shipped').reduce((s, o) => s + o.total, 0);
    return { customer: c, addresses, orders, prices, spent };
  }));
  app.post('/api/customers/:id/addresses', h((req) => tx(() => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id)) || notFound('找不到客戶');
    const address = clean(req.body?.address) || bad('請填寫地址');
    if (req.body?.is_default) db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').run(c.id);
    const id = db.prepare('INSERT INTO customer_addresses (customer_id, label, address, is_default) VALUES (?, ?, ?, ?)').run(c.id, clean(req.body?.label) || null, address, req.body?.is_default ? 1 : 0).lastInsertRowid;
    audit(db, { user: U(req), category: '設定', action: '新增送貨地址', obj_type: 'customer', obj_id: c.customer_no, obj_label: c.name, changes: { 地址: address } });
    return { id };
  })));
  app.delete('/api/addresses/:id', h((req) => tx(() => {
    const a = db.prepare('SELECT a.*, c.customer_no, c.name FROM customer_addresses a JOIN customers c ON c.id = a.customer_id WHERE a.id = ?').get(Number(req.params.id)) || notFound('找不到地址');
    db.prepare('DELETE FROM customer_addresses WHERE id = ?').run(a.id);
    audit(db, { user: U(req), category: '設定', action: '刪除送貨地址', obj_type: 'customer', obj_id: a.customer_no, obj_label: a.name, changes: { 地址: a.address } });
    return { ok: true };
  })));

  // 酒款的銷售紀錄（酒款明細用）
  app.get('/api/wines/:no/sales', h((req) => db.prepare(`SELECT o.order_no, o.order_date, o.status, c.name customer, l.qty, l.unit_price, l.discount FROM order_lines l JOIN orders o ON o.id = l.order_id
    LEFT JOIN customers c ON c.id = o.customer_id WHERE l.wine_id = (SELECT id FROM wines WHERE wine_no = ?) AND o.status IN ('confirmed','shipped') ORDER BY o.order_date DESC, o.id DESC LIMIT 50`).all(req.params.no)));
}
