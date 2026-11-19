// 里程碑 3：查價助手、批次更新價格、手機離線同步、盤點
import crypto from 'node:crypto';
import { audit } from './db.js';
import { clean } from './importer.js';
import { latestPrice, latestDate } from './search.js';
import { stockOut } from './stockout.js';
import { h, bad, notFound, today, intOrNull, HttpError, addPrice, moveItems, setStatus, createList, readSettings, locationLabel, wineIdsFrom } from './m2.js';

const BIG_CHANGE = 0.2;
let nextAllowedAt = 0; // 下一次可以開啟查價頁的時間（毫秒）

export function lookupUrl(template, w) {
  if (w.ws_url) return w.ws_url;
  const enc = (v) => encodeURIComponent(String(v ?? '').trim()).replace(/%20/g, '+');
  return String(template || '')
    .replace('{name}', enc(w.name)).replace('{winery}', enc(w.winery))
    .replace('{vintage}', enc(w.vintage === 'NV' ? 'NV' : w.vintage)).replace('{volume}', enc(w.volume_ml));
}
// 手機送來的是 UTC ISO 時間，紀錄用這台電腦的當地時間
const localTs = (iso) => { const d = new Date(iso); if (isNaN(d)) return String(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const pct = (from, to) => (from ? (to - from) / from : null);

export function mountM3(app, db) {
  const tx = (fn) => db.transaction(fn)();
  const U = (req) => req.user.login;
  const priceCfg = () => readSettings(db).price;

  // ===== 查價 =====
  function quota() {
    const c = priceCfg();
    const hour = db.prepare("SELECT COUNT(*) n FROM price_lookups WHERE ts >= datetime('now','localtime','-1 hour')").get().n;
    const day = db.prepare("SELECT COUNT(*) n FROM price_lookups WHERE ts >= date('now','localtime')").get().n;
    return { hour, day, per_hour: Number(c.per_hour) || 100, per_day: Number(c.per_day) || 300, wait_ms: Math.max(0, nextAllowedAt - Date.now()), min_wait: Number(c.min_wait) || 10, max_wait: Number(c.max_wait) || 20 };
  }
  app.get('/api/price/quota', h(() => quota()));

  function queueItems(q) {
    const c = priceCfg();
    let ids;
    if (q.list) ids = db.prepare('SELECT wine_id FROM list_items WHERE list_id = ? ORDER BY pos, id').all(Number(q.list)).map((r) => r.wine_id);
    else if (q.wine_nos) ids = String(q.wine_nos).split(',').map((no) => db.prepare('SELECT id FROM wines WHERE wine_no = ?').get(no)?.id).filter(Boolean);
    else ids = wineIdsFrom(db, { query: { ...q, stale: q.stale ?? '1' } });
    const one = db.prepare(`SELECT w.id, w.wine_no, w.winery, w.name, w.vintage, w.volume_ml, w.ws_url, t.zh type_zh, t.en type_en,
      (SELECT COUNT(*) FROM bottles b WHERE b.wine_id = w.id AND b.status = 'in_stock') qty,
      (SELECT COUNT(DISTINCT case_id) FROM bottles b WHERE b.wine_id = w.id AND b.status = 'in_stock') cases,
      ${latestPrice} price, ${latestDate} price_date,
      (SELECT MAX(ts) FROM price_lookups pl WHERE pl.wine_id = w.id AND pl.result = 'saved') last_saved
      FROM wines w LEFT JOIN wine_types t ON t.code = w.type_code WHERE w.id = ?`);
    return ids.map((id) => { const w = one.get(id); return { ...w, url: lookupUrl(c.url_template, w), done: !!(w.last_saved && w.last_saved >= today()) }; });
  }
  app.get('/api/price/queue', h((req) => {
    const items = queueItems(req.query);
    const stale = db.prepare(`SELECT date('now','localtime','-' || ? || ' days') d`).get(Number(priceCfg().stale_days) || 30).d;
    return { items, staleBefore: stale, quota: quota(), cases: items.reduce((s, i) => s + i.cases, 0) };
  }));

  app.post('/api/price/open', h((req) => tx(() => {
    const w = db.prepare('SELECT * FROM wines WHERE wine_no = ?').get(req.body?.wine_no) || notFound('找不到酒款');
    const q = quota();
    if (q.day >= q.per_day) throw new HttpError(429, `今天已查 ${q.day} 款，達到每天上限 ${q.per_day}。明天再繼續。`);
    if (q.hour >= q.per_hour) throw new HttpError(429, `這一小時已查 ${q.hour} 款，達到上限 ${q.per_hour}。請稍後再繼續。`);
    if (q.wait_ms > 0) throw new HttpError(429, `請再等 ${Math.ceil(q.wait_ms / 1000)} 秒再開下一款。`);
    const url = lookupUrl(priceCfg().url_template, w);
    const id = db.prepare('INSERT INTO price_lookups (user_login, wine_id, url) VALUES (?, ?, ?)').run(U(req), w.id, url).lastInsertRowid;
    const wait = q.min_wait + Math.random() * Math.max(0, q.max_wait - q.min_wait);
    nextAllowedAt = Date.now() + wait * 1000;
    return { lookup_id: id, url, quota: quota() };
  })));

  app.post('/api/price/save', h((req) => tx(() => {
    const b = req.body || {};
    const w = db.prepare('SELECT * FROM wines WHERE wine_no = ?').get(b.wine_no) || notFound('找不到酒款');
    const price = intOrNull(b.price);
    if (!price || price <= 0) bad('請輸入價格');
    const prev = db.prepare(`SELECT price FROM price_history WHERE wine_id = ? AND voided = 0 ORDER BY effective_date DESC, id DESC LIMIT 1`).get(w.id);
    const change = pct(prev?.price, price);
    if (change != null && Math.abs(change) > BIG_CHANGE && !b.confirm) throw Object.assign(new HttpError(409, `價格變動 ${(change * 100).toFixed(1)}%，超過 ±20%，請再確認一次。`), {});
    const r = addPrice(db, w, { price, date: b.date || today(), source: priceCfg().site || 'Wine-Searcher', url: clean(b.url) || null }, U(req), { tag: '（查價助手）' });
    if (b.lookup_id) db.prepare("UPDATE price_lookups SET result = 'saved', url = COALESCE(?, url) WHERE id = ?").run(clean(b.url) || null, Number(b.lookup_id));
    return { ...r, change };
  })));
  app.post('/api/price/skip', h((req) => {
    if (req.body?.lookup_id) db.prepare("UPDATE price_lookups SET result = 'skipped' WHERE id = ?").run(Number(req.body.lookup_id));
    return { ok: true };
  }));

  // 在列表中批次輸入價格
  app.post('/api/prices/batch', h((req) => {
    const b = req.body || {};
    const date = b.date || today();
    if (!/^\d{4}-\d\d-\d\d$/.test(date)) bad('日期格式需為 YYYY-MM-DD');
    const confirmed = new Set(b.confirm || []);
    const rows = (b.items || []).filter((i) => i.price !== '' && i.price != null).map((i) => {
      const w = db.prepare('SELECT * FROM wines WHERE wine_no = ?').get(i.wine_no) || bad('找不到酒款 ' + i.wine_no);
      const price = intOrNull(i.price);
      if (!price || price <= 0) bad(`${w.name}：價格不正確`);
      const prev = db.prepare('SELECT price FROM price_history WHERE wine_id = ? AND voided = 0 ORDER BY effective_date DESC, id DESC LIMIT 1').get(w.id);
      return { w, price, prev: prev?.price ?? null, change: pct(prev?.price, price) };
    });
    if (!rows.length) bad('沒有要儲存的價格');
    const big = rows.filter((r) => r.change != null && Math.abs(r.change) > BIG_CHANGE && !confirmed.has(r.w.wine_no));
    if (big.length) {
      const e = new HttpError(409, `${big.length} 款價格變動超過 ±20%，請確認`);
      e.big = big.map((r) => ({ wine_no: r.w.wine_no, name: r.w.name, from: r.prev, to: r.price, change: r.change }));
      throw e;
    }
    const batch = 'PR-' + Date.now().toString(36).toUpperCase();
    return tx(() => {
      for (const r of rows) addPrice(db, r.w, { price: r.price, date, source: clean(b.source) || '手動輸入' }, U(req), { batch, tag: '（批次）' });
      return { saved: rows.length, batch };
    });
  }));

  // ===== 手機離線 =====
  app.get('/api/offline/snapshot', h(() => {
    const version = db.prepare('SELECT COALESCE(MAX(id), 0) v FROM audit_log').get().v;
    return {
      version, at: new Date().toISOString(),
      cellars: db.prepare('SELECT id, name FROM cellars ORDER BY name').all(),
      lockers: db.prepare('SELECT id, cellar_id, code FROM lockers').all().sort((a, b) => a.code.localeCompare(b.code, 'zh-Hant', { numeric: true })),
      racks: db.prepare('SELECT id, locker_id, code, is_default FROM racks ORDER BY is_default DESC, code').all(),
      cases: db.prepare('SELECT case_no, rack_id, capacity, location_uncertain uncertain FROM cases').all(),
      // 手機副本不含採購價格、酒商、客戶與設定
      wines: db.prepare(`SELECT w.id, w.wine_no, w.winery, w.name, w.vintage, w.region, w.volume_ml, w.type_code, t.zh type_zh, t.en type_en, ${latestPrice} price, ${latestDate} price_date
        FROM wines w LEFT JOIN wine_types t ON t.code = w.type_code WHERE EXISTS (SELECT 1 FROM bottles b WHERE b.wine_id = w.id)`).all(),
      bottles: db.prepare(`SELECT b.bottle_no, b.wine_id, c.case_no, b.rack_id, b.status FROM bottles b LEFT JOIN cases c ON c.id = b.case_id WHERE b.status IN ('in_stock', 'reserved')`).all(),
      types: db.prepare('SELECT code, zh, en FROM wine_types').all(),
    };
  }));

  const bottleNow = (no) => db.prepare('SELECT b.bottle_no, b.rack_id, b.status, c.case_no FROM bottles b LEFT JOIN cases c ON c.id = b.case_id WHERE b.bottle_no = ?').get(no);
  const whereLabel = (x) => (x ? (x.case_no ? `酒箱 ${x.case_no} @ ` : '散瓶 @ ') + locationLabel(db, x.rack_id) : '—');
  function lastChange(opTs, codes) {
    for (const code of codes) {
      const r = db.prepare(`SELECT ts, user_login, action FROM audit_log WHERE category = '庫存' AND (obj_id = ? OR changes LIKE ?) ORDER BY id DESC LIMIT 1`).get(code, `%${code}%`);
      if (r) return r;
    }
    return null;
  }

  // 檢查衝突：手機離線時看到的狀態（base）和伺服器現在不一樣
  function findConflict(op) {
    const p = op.payload || {}, base = op.base || {};
    if (op.type === 'move_bottles' || op.type === 'status' || op.type === 'stockout') {
      const diffs = [];
      for (const no of p.bottle_nos || []) {
        const now = bottleNow(no), was = base.bottles?.[no];
        if (!now || !was) continue;
        const changed = op.type === 'status' || op.type === 'stockout' ? now.status !== was.status : now.rack_id !== was.rack_id || (now.case_no || null) !== (was.case_no || null) || now.status !== was.status;
        if (changed) diffs.push({ bottle_no: no, was: whereLabel(was), now: whereLabel(now), status: now.status });
      }
      if (diffs.length) return { diffs, by: lastChange(op.ts, diffs.map((d) => d.bottle_no)) };
    }
    if (op.type === 'move_case') {
      const c = db.prepare('SELECT case_no, rack_id FROM cases WHERE case_no = ?').get(p.case_no);
      if (c && base.rack_id && c.rack_id !== base.rack_id) return { diffs: [{ case_no: c.case_no, was: locationLabel(db, base.rack_id), now: locationLabel(db, c.rack_id) }], by: lastChange(op.ts, [c.case_no]) };
    }
    return null;
  }

  function applyOp(op, user, tag) {
    const p = op.payload || {};
    const extra = { tag, changes: { 手機操作時間: localTs(op.ts).slice(0, 16) }, batch: 'SYNC-' + op.id.slice(0, 8) };
    if (op.type === 'move_bottles') return moveItems(db, { what: 'bottles', bottle_nos: p.bottle_nos, dest: p.dest, note: p.note }, user, extra);
    if (op.type === 'move_case') return moveItems(db, { what: 'case', case_no: p.case_no, dest: { rack_id: p.rack_id }, note: p.note }, user, extra);
    if (op.type === 'status') return setStatus(db, p, user, extra);
    if (op.type === 'stockout') return stockOut(db, p, user, extra);
    if (op.type === 'list_create') return createList(db, p, user, extra);
    if (op.type === 'count') return createStocktake(p, user, op.ts);
    bad('不支援的操作：' + op.type);
  }

  app.post('/api/offline/sync', h((req) => {
    const { device = null, ops = [] } = req.body || {};
    const results = [];
    for (const op of ops) {
      if (!op?.id || !op.type || !op.ts) { results.push({ id: op?.id, status: 'rejected', error: '格式不正確' }); continue; }
      const seen = db.prepare('SELECT status, result FROM offline_ops WHERE id = ?').get(op.id);
      if (seen) { results.push({ id: op.id, status: seen.status, ...JSON.parse(seen.result || '{}') }); continue; }
      let status, result;
      try {
        tx(() => {
          const conflict = findConflict(op);
          if (conflict) { status = 'conflict'; result = { conflict }; }
          else { status = 'applied'; result = { result: applyOp(op, U(req), '（離線同步）') }; }
          db.prepare('INSERT INTO offline_ops (id, user_login, device, op_ts, type, payload, status, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(op.id, U(req), device, op.ts, op.type, JSON.stringify({ payload: op.payload, base: op.base }), status, JSON.stringify(result));
        });
      } catch (e) {
        status = 'rejected'; result = { error: e.message };
        db.prepare('INSERT OR IGNORE INTO offline_ops (id, user_login, device, op_ts, type, payload, status, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(op.id, U(req), device, op.ts, op.type, JSON.stringify({ payload: op.payload, base: op.base }), status, JSON.stringify(result));
      }
      results.push({ id: op.id, status, ...result });
    }
    return { results, conflicts: results.filter((r) => r.status === 'conflict').length };
  }));

  app.get('/api/offline/conflicts', h((req) => db.prepare("SELECT * FROM offline_ops WHERE user_login = ? AND status = 'conflict' ORDER BY op_ts").all(U(req))
    .map((r) => ({ ...r, ...JSON.parse(r.payload), ...JSON.parse(r.result) }))));

  app.post('/api/offline/resolve', h((req) => tx(() => {
    const { id, choice } = req.body || {};
    const r = db.prepare("SELECT * FROM offline_ops WHERE id = ? AND status = 'conflict'").get(id) || notFound('找不到這筆衝突，可能已處理');
    const { payload, base } = JSON.parse(r.payload);
    const op = { id: r.id, ts: r.op_ts, type: r.type, payload, base };
    let result;
    if (choice === 'mine') result = applyOp(op, U(req), '（離線同步・保留手機）');
    else if (choice === 'server') {
      audit(db, { user: U(req), category: '庫存', action: '離線同步衝突：保留伺服器', obj_type: r.type === 'move_case' ? 'case' : 'bottle', obj_id: payload.case_no || (payload.bottle_nos || []).join(', '),
        obj_label: '捨棄手機上的操作', changes: { 手機操作時間: localTs(r.op_ts).slice(0, 16), 類型: { move_bottles: '移動酒瓶', move_case: '移動酒箱', status: '變更狀態', stockout: '出庫' }[r.type] || r.type } });
      result = { kept: 'server' };
    } else bad('請選擇要保留哪一個');
    db.prepare("UPDATE offline_ops SET status = 'resolved', result = ? WHERE id = ?").run(JSON.stringify({ choice, result }), r.id);
    return { ok: true, result };
  })));

  // ===== 盤點 =====
  function createStocktake(p, user, startedAt) {
    const l = db.prepare('SELECT l.*, c.name cellar FROM lockers l JOIN cellars c ON c.id = l.cellar_id WHERE l.id = ?').get(Number(p.locker_id)) || bad('找不到分儲空間');
    const codes = [...new Set((p.codes || []).map((c) => clean(c).replace(/^MW:/i, '')).filter(Boolean))];
    const expectedCases = db.prepare(`SELECT c.case_no, COUNT(b.id) qty, GROUP_CONCAT(DISTINCT w.name) wines FROM cases c JOIN racks k ON k.id = c.rack_id
      JOIN bottles b ON b.case_id = c.id AND b.status = 'in_stock' JOIN wines w ON w.id = b.wine_id WHERE k.locker_id = ? GROUP BY c.id`).all(l.id);
    const expectedLoose = db.prepare(`SELECT b.bottle_no, w.name FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN wines w ON w.id = b.wine_id
      WHERE k.locker_id = ? AND b.case_id IS NULL AND b.status = 'in_stock'`).all(l.id);
    const foundCases = new Set(), foundBottles = new Set(), elsewhere = [], unknown = [];
    for (const code of codes) {
      const caseNo = code.replace(/^(?:CASE|C):/i, '');
      const c = db.prepare('SELECT c.case_no, c.rack_id, k.locker_id FROM cases c JOIN racks k ON k.id = c.rack_id WHERE c.case_no = ?').get(caseNo);
      if (c) { if (c.locker_id === l.id) foundCases.add(c.case_no); else elsewhere.push({ code: c.case_no, kind: 'case', recorded: locationLabel(db, c.rack_id) }); continue; }
      const b = db.prepare('SELECT b.bottle_no, b.rack_id, b.status, k.locker_id, c.case_no FROM bottles b JOIN racks k ON k.id = b.rack_id LEFT JOIN cases c ON c.id = b.case_id WHERE b.bottle_no = ?').get(code.toUpperCase());
      if (b) {
        if (b.locker_id === l.id && b.status === 'in_stock') { foundBottles.add(b.bottle_no); if (b.case_no) foundCases.add(b.case_no); }
        else elsewhere.push({ code: b.bottle_no, kind: 'bottle', recorded: b.status !== 'in_stock' ? '狀態：' + b.status : (b.case_no ? `酒箱 ${b.case_no} @ ` : '') + locationLabel(db, b.rack_id) });
        continue;
      }
      if (/^(LOCKER|RACK):/i.test(code)) continue;
      unknown.push(code);
    }
    const report = {
      locker: `${l.cellar} › ${l.code}`,
      expected: { cases: expectedCases.length, loose: expectedLoose.length, bottles: expectedCases.reduce((s, c) => s + c.qty, 0) + expectedLoose.length },
      found: expectedCases.filter((c) => foundCases.has(c.case_no)),
      missing: expectedCases.filter((c) => !foundCases.has(c.case_no)),
      looseFound: expectedLoose.filter((b) => foundBottles.has(b.bottle_no)),
      looseMissing: expectedLoose.filter((b) => !foundBottles.has(b.bottle_no)),
      elsewhere, unknown,
    };
    const id = db.prepare('INSERT INTO stocktakes (locker_id, user_login, started_at, scanned, report) VALUES (?, ?, ?, ?, ?)').run(l.id, user, startedAt || null, JSON.stringify(codes), JSON.stringify(report)).lastInsertRowid;
    audit(db, { user, category: '庫存', action: '盤點', obj_type: 'stocktake', obj_id: String(id), obj_label: report.locker,
      changes: { 掃描: codes.length, 應有箱數: report.expected.cases, 找到: report.found.length, 未找到: report.missing.length, 不在此處: elsewhere.length } });
    return { id, report };
  }
  app.post('/api/stocktakes', h((req) => tx(() => createStocktake(req.body || {}, U(req), req.body?.started_at))));
  app.get('/api/stocktakes', h(() => db.prepare('SELECT id, locker_id, user_login, started_at, created_at, closed, report FROM stocktakes ORDER BY id DESC LIMIT 100').all()
    .map((s) => { const r = JSON.parse(s.report); return { ...s, report: undefined, locker: r.locker, missing: r.missing.length + r.looseMissing.length, elsewhere: r.elsewhere.length, found: r.found.length, expected: r.expected.cases }; })));
  app.get('/api/stocktakes/:id', h((req) => {
    const s = db.prepare('SELECT * FROM stocktakes WHERE id = ?').get(Number(req.params.id)) || notFound('找不到盤點紀錄');
    const racks = db.prepare('SELECT id, code, is_default FROM racks WHERE locker_id = ? ORDER BY is_default DESC, code').all(s.locker_id);
    return { ...s, scanned: JSON.parse(s.scanned), report: JSON.parse(s.report), racks };
  }));
  app.post('/api/stocktakes/:id/close', h((req) => {
    db.prepare('UPDATE stocktakes SET closed = 1 WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  }));
}
