// 出庫（不經過訂單）：自用、贈送、試飲、破損、盤點短少、輸入錯誤、其他；以及刪除輸入錯誤的酒款
import fs from 'node:fs';
import path from 'node:path';
import { audit } from './db.js';
import { clean } from './importer.js';
import { h, bad, notFound, HttpError, wineIdsFrom, locationLabel, PHOTO_DIR } from './m2.js';

export const REASONS = { own: '自用', gift: '贈送', tasting: '試飲', broken: '破損', shortage: '盤點短少', mistake: '輸入錯誤', other: '其他' };

// 依位置挑瓶：先散瓶，再瓶數少的酒箱
function pickBottles(db, wineId, qty, exclude) {
  return db.prepare(`SELECT b.id FROM bottles b LEFT JOIN cases c ON c.id = b.case_id WHERE b.wine_id = ? AND b.status = 'in_stock'
    ORDER BY CASE WHEN b.case_id IS NULL THEN 0 ELSE 1 END, (SELECT COUNT(*) FROM bottles x WHERE x.case_id = b.case_id AND x.status = 'in_stock'), c.case_no, b.bottle_no`)
    .all(wineId).map((r) => r.id).filter((id) => !exclude.has(id)).slice(0, qty);
}

export function stockOut(db, { bottle_nos = [], case_nos = [], picks = [], reason, note }, user, extra = {}) {
  if (!REASONS[reason]) bad('請選擇出庫原因');
  const memo = clean(note);
  if (reason === 'other' && !memo) bad('原因選「其他」時請填寫說明');
  const ids = new Set();
  const errors = [];
  const one = db.prepare(`SELECT b.id, b.bottle_no, b.status, o.order_no FROM bottles b LEFT JOIN order_bottles ob ON ob.bottle_id = b.id AND ob.state = 'reserved' LEFT JOIN orders o ON o.id = ob.order_id WHERE b.bottle_no = ?`);
  for (const raw of bottle_nos) {
    const b = one.get(clean(raw).toUpperCase());
    if (!b) { errors.push(`${raw}：找不到瓶號`); continue; }
    if (b.status === 'reserved') { errors.push(`${b.bottle_no}：已被訂單 ${b.order_no || ''} 保留，請先修改訂單`); continue; }
    if (b.status !== 'in_stock') { errors.push(`${b.bottle_no}：不在庫`); continue; }
    ids.add(b.id);
  }
  for (const no of case_nos) {
    const c = db.prepare('SELECT id FROM cases WHERE case_no = ?').get(clean(no));
    if (!c) { errors.push(`${no}：找不到酒箱`); continue; }
    const list = db.prepare("SELECT id FROM bottles WHERE case_id = ? AND status = 'in_stock'").all(c.id);
    if (!list.length) errors.push(`${no}：箱內沒有在庫的酒`);
    list.forEach((r) => ids.add(r.id));
  }
  for (const p of picks) {
    const qty = Number(p.qty) || 0;
    if (!qty) continue;
    const w = db.prepare('SELECT id, name, vintage FROM wines WHERE wine_no = ?').get(p.wine_no);
    if (!w) { errors.push(`${p.wine_no}：找不到酒款`); continue; }
    const got = pickBottles(db, w.id, qty, ids);
    if (got.length < qty) { errors.push(`${w.name} ${w.vintage}：要 ${qty} 瓶，在庫只有 ${got.length} 瓶`); continue; }
    got.forEach((id) => ids.add(id));
  }
  if (errors.length) throw new HttpError(400, errors.join('；'));
  if (!ids.size) bad('請選擇要出庫的酒');
  const status = reason === 'broken' ? 'broken' : 'out';
  const label = REASONS[reason] + (memo ? '：' + memo : '');
  const rows = [...ids].map((id) => db.prepare(`SELECT b.id, b.bottle_no, b.rack_id, b.wine_id, c.case_no, w.wine_no, w.name, w.vintage FROM bottles b JOIN wines w ON w.id = b.wine_id
    LEFT JOIN cases c ON c.id = b.case_id WHERE b.id = ?`).get(id));
  const upd = db.prepare("UPDATE bottles SET status = ?, out_reason = ?, out_at = datetime('now','localtime') WHERE id = ?");
  for (const r of rows) upd.run(status, label, r.id);
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.wine_id)) groups.set(r.wine_id, []); groups.get(r.wine_id).push(r); }
  for (const list of groups.values()) {
    const r0 = list[0];
    const where = [...new Set(list.map((x) => (x.case_no ? `酒箱 ${x.case_no}` : '散瓶') + ' @ ' + locationLabel(db, x.rack_id)))].join('、');
    audit(db, { user, category: '庫存', action: '出庫' + (extra.tag || ''), obj_type: 'wine', obj_id: r0.wine_no, obj_label: `${r0.name} ${r0.vintage}`,
      changes: { 原因: REASONS[reason], 瓶數: list.length, 瓶號: list.map((x) => x.bottle_no).join(', '), 位置: where, ...(extra.changes || {}) }, reason: memo || null, batch_id: extra.batch || null });
  }
  return { count: rows.length, bottle_nos: rows.map((r) => r.bottle_no) };
}

export function mountStockout(app, db) {
  const tx = (fn) => db.transaction(fn)();
  const U = (req) => req.user.login;

  app.get('/api/stockout/reasons', h(() => REASONS));
  // 出庫畫面：列出酒款與在庫瓶數
  app.post('/api/stockout/candidates', h((req) => {
    const ids = wineIdsFrom(db, req.body || {});
    const listIds = req.body?.list ? db.prepare('SELECT wine_id FROM list_items WHERE list_id = ? ORDER BY pos, id').all(Number(req.body.list)).map((r) => r.wine_id) : [];
    return [...new Set([...listIds, ...ids])].map((id) => db.prepare(`SELECT w.wine_no, w.winery, w.name, w.vintage, w.volume_ml,
      (SELECT COUNT(*) FROM bottles b WHERE b.wine_id = w.id AND b.status = 'in_stock') available,
      (SELECT COUNT(*) FROM bottles b WHERE b.wine_id = w.id AND b.status = 'reserved') reserved FROM wines w WHERE w.id = ?`).get(id)).filter(Boolean);
  }));
  app.post('/api/stockout', h((req) => tx(() => stockOut(db, req.body || {}, U(req)))));

  // 刪除酒款：只限輸入錯誤、從未上過訂單或出貨的酒款
  function deletable(w) {
    const lines = db.prepare('SELECT COUNT(*) n FROM order_lines WHERE wine_id = ?').get(w.id).n;
    const shipped = db.prepare("SELECT COUNT(*) n FROM bottles WHERE wine_id = ? AND status = 'shipped'").get(w.id).n;
    if (lines) return { ok: false, why: `這款酒在 ${lines} 筆訂單明細中，不能刪除；請改用「出庫」。` };
    if (shipped) return { ok: false, why: '這款酒有出貨紀錄，不能刪除；請改用「出庫」。' };
    return { ok: true };
  }
  app.get('/api/wines/:no/deletable', h((req) => {
    const w = db.prepare('SELECT * FROM wines WHERE wine_no = ?').get(req.params.no) || notFound('找不到酒款');
    const d = deletable(w);
    return { ...d, bottles: db.prepare('SELECT COUNT(*) n FROM bottles WHERE wine_id = ?').get(w.id).n };
  }));
  app.delete('/api/wines/:no', h((req) => tx(() => {
    const w = db.prepare('SELECT * FROM wines WHERE wine_no = ?').get(req.params.no) || notFound('找不到酒款');
    const d = deletable(w);
    if (!d.ok) bad(d.why);
    const reason = clean(req.body?.reason) || bad('請填寫刪除原因');
    const bottles = db.prepare('SELECT b.id, b.bottle_no, b.case_id FROM bottles b WHERE wine_id = ? ORDER BY bottle_no').all(w.id);
    const caseIds = [...new Set(bottles.map((b) => b.case_id).filter(Boolean))];
    const photos = db.prepare('SELECT file FROM photos WHERE wine_id = ?').all(w.id);
    db.prepare('DELETE FROM list_items WHERE wine_id = ?').run(w.id);
    db.prepare('DELETE FROM photos WHERE wine_id = ?').run(w.id);
    db.prepare('DELETE FROM price_lookups WHERE wine_id = ?').run(w.id);
    db.prepare('DELETE FROM price_history WHERE wine_id = ?').run(w.id);
    db.prepare('DELETE FROM bottles WHERE wine_id = ?').run(w.id);
    db.prepare('DELETE FROM lots WHERE wine_id = ?').run(w.id);
    const emptied = [];
    for (const cid of caseIds) if (!db.prepare('SELECT 1 FROM bottles WHERE case_id = ?').get(cid)) { emptied.push(db.prepare('SELECT case_no FROM cases WHERE id = ?').get(cid)?.case_no); db.prepare('DELETE FROM cases WHERE id = ?').run(cid); }
    db.prepare('DELETE FROM wines WHERE id = ?').run(w.id);
    for (const p of photos) fs.rmSync(path.join(PHOTO_DIR, p.file), { force: true });
    audit(db, { user: U(req), category: '酒款', action: '刪除酒款', obj_type: 'wine', obj_id: w.wine_no, obj_label: `${w.name} ${w.vintage}`,
      changes: { 酒莊: w.winery, 品名: w.name, 年份: w.vintage, 容量: w.volume_ml, 瓶數: bottles.length, ...(bottles.length ? { 瓶號: `${bottles[0].bottle_no} – ${bottles.at(-1).bottle_no}` } : {}), ...(emptied.length ? { 一併刪除空酒箱: emptied.join(', ') } : {}) }, reason });
    return { ok: true, bottles: bottles.length, cases: emptied.length };
  })));
}
