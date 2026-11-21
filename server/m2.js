// 里程碑 2：酒款新增／編輯、移動、清單、標籤、匯出、設定
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, audit, nextNo } from './db.js';
import { buildSearch, SQL } from './search.js';
import { searchKey, wineKey, clean } from './importer.js';
import { mountBatch } from './batch.js';

const { latestPrice, latestDate } = SQL;
export const PHOTO_DIR = path.join(process.env.MYWINES_DATA || path.join(ROOT, 'data'), 'photos');

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export const bad = (msg) => { throw new HttpError(400, msg); };
export const notFound = (msg) => { throw new HttpError(404, msg); };
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const intOrNull = (v) => (v === '' || v == null ? null : Number.isFinite(Number(String(v).replace(/,/g, ''))) ? Math.round(Number(String(v).replace(/,/g, ''))) : bad('數字格式不正確：' + v));

// 包一層：同步錯誤 → JSON
export const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') out.then((v) => v !== undefined && !res.headersSent && res.json(v)).catch((e) => sendErr(res, e, next));
    else if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) { sendErr(res, e, next); }
};
function sendErr(res, e, next) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.big ? { big: e.big } : {}) });
  if (/UNIQUE constraint/.test(e.message)) return res.status(409).json({ error: '資料重複：' + e.message.replace(/^.*failed: /, '') });
  next(e);
}

export function locationLabel(db, rackId) {
  return db.prepare(`SELECT ce.name || ' › ' || l.code || ' › ' || k.code label FROM racks k JOIN lockers l ON l.id = k.locker_id
    JOIN cellars ce ON ce.id = l.cellar_id WHERE k.id = ?`).get(rackId)?.label;
}

export function newCaseNo(db) {
  const d = today();
  const prefix = `${d.slice(5, 7)}-${d.slice(8, 10)}-${d.slice(2, 4)}-`;
  const used = new Set(db.prepare('SELECT case_no FROM cases WHERE case_no LIKE ?').all(prefix + '%').map((r) => r.case_no));
  for (let i = 1; i < 1000; i++) { const no = prefix + String(i).padStart(2, '0'); if (!used.has(no)) return no; }
  bad('今天的箱號已用完');
}

function merchantId(db, m) {
  if (m == null || m === '') return null;
  if (typeof m === 'number' || /^\d+$/.test(String(m))) return Number(m);
  const name = clean(m);
  return db.prepare('SELECT id FROM merchants WHERE name = ?').get(name)?.id ?? db.prepare('INSERT INTO merchants (name) VALUES (?)').run(name).lastInsertRowid;
}

// 入庫：產生瓶號，放入新酒箱／現有酒箱／散瓶
function stockIn(db, wine, s, user, batchId) {
  const qty = Number(s.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 600) bad('瓶數需為 1–600 的整數');
  const dest = resolveDest(db, s.dest || {});
  const lotId = db.prepare('INSERT INTO lots (wine_id, merchant_id, purchase_price, purchase_date, note) VALUES (?, ?, ?, ?, ?)')
    .run(wine.id, merchantId(db, s.merchant), intOrNull(s.cost), s.date || today(), s.note || null).lastInsertRowid;
  const caseId = dest.caseId;
  const ins = db.prepare('INSERT INTO bottles (bottle_no, wine_id, lot_id, case_id, rack_id) VALUES (?, ?, ?, ?, ?)');
  const nos = [];
  for (let i = 0; i < qty; i++) { const no = nextNo(db, 'bottle', 'B-', 7); ins.run(no, wine.id, lotId, caseId, dest.rackId); nos.push(no); }
  audit(db, { user, category: '庫存', action: '入庫', obj_type: 'wine', obj_id: wine.wine_no, obj_label: `${wine.name} ${wine.vintage}`, batch_id: batchId,
    changes: { 瓶數: qty, 瓶號: `${nos[0]} – ${nos.at(-1)}`, 位置: dest.label, ...(dest.caseNo ? { 箱號: dest.caseNo } : {}), ...(s.cost ? { 採購價格: intOrNull(s.cost) } : {}) } });
  return { bottle_nos: nos, case_no: dest.caseNo, warning: dest.capacity && dest.count + qty > dest.capacity ? `酒箱 ${dest.caseNo} 將有 ${dest.count + qty} 瓶，超過容量 ${dest.capacity}` : null };
}

// 目的地：{ mode: 'case' | 'newcase' | 'loose', rack_id, case_no, capacity }
function resolveDest(db, d) {
  if (d.mode === 'case') {
    const c = db.prepare('SELECT * FROM cases WHERE case_no = ?').get(d.case_no) || bad('找不到酒箱 ' + d.case_no);
    const count = db.prepare("SELECT COUNT(*) n FROM bottles WHERE case_id = ? AND status = 'in_stock'").get(c.id).n;
    return { rackId: c.rack_id, caseId: c.id, caseNo: c.case_no, capacity: c.capacity, count, label: locationLabel(db, c.rack_id) };
  }
  const rack = db.prepare('SELECT * FROM racks WHERE id = ?').get(Number(d.rack_id)) || bad('請選擇架子');
  if (d.mode === 'newcase') {
    const no = clean(d.case_no) || newCaseNo(db);
    if (db.prepare('SELECT 1 FROM cases WHERE case_no = ?').get(no)) bad('箱號已存在：' + no);
    const id = db.prepare('INSERT INTO cases (case_no, rack_id, capacity, kind) VALUES (?, ?, ?, ?)').run(no, rack.id, intOrNull(d.capacity) ?? 6, d.kind || null).lastInsertRowid;
    return { rackId: rack.id, caseId: id, caseNo: no, capacity: intOrNull(d.capacity) ?? 6, count: 0, label: locationLabel(db, rack.id), created: true };
  }
  return { rackId: rack.id, caseId: null, caseNo: null, label: locationLabel(db, rack.id) };
}

const WINE_FIELDS = { country: '國家', winery: '酒莊', name: '品名', region: '產區', vintage: '年份', type_code: '種類', volume_ml: '容量',
  suggested_price: '建議售價', grapes: '葡萄品種', classification: '分級', notes: '備註', ws_url: '查價網址' };

function normWine(b) {
  const w = {};
  for (const k of Object.keys(WINE_FIELDS)) if (k in b) w[k] = typeof b[k] === 'string' ? clean(b[k]) : b[k];
  if ('vintage' in w) {
    const v = String(w.vintage || '').toUpperCase();
    w.vintage = v === '' || v === 'NV' ? 'NV' : /^(18|19|20)\d\d$/.test(v) ? v : bad('年份需為 4 位數字或 NV');
  }
  if ('volume_ml' in w) w.volume_ml = intOrNull(w.volume_ml) ?? 750;
  if ('suggested_price' in w) w.suggested_price = intOrNull(w.suggested_price);
  return w;
}

export const STATUS = { in_stock: '在庫', reserved: '保留', shipped: '已出貨', broken: '破損', out: '已出庫' };
export function setStatus(db, { bottle_nos = [], status, reason }, user, extra = {}) {
  if (!STATUS[status]) bad('狀態不正確');
  if (status !== 'in_stock' && !clean(reason)) bad('請填寫原因');
  let n = 0;
  for (const no of bottle_nos) {
    const b = db.prepare('SELECT b.*, w.name, w.vintage FROM bottles b JOIN wines w ON w.id = b.wine_id WHERE bottle_no = ?').get(no) || bad('找不到瓶號 ' + no);
    if (b.status === status) continue;
    // 被訂單保留的酒瓶改成其他狀態：從訂單的保留中移除
    const held = b.status === 'reserved' && db.prepare("SELECT o.order_no FROM order_bottles ob JOIN orders o ON o.id = ob.order_id WHERE ob.bottle_id = ? AND ob.state = 'reserved'").get(b.id);
    if (held) db.prepare("DELETE FROM order_bottles WHERE bottle_id = ? AND state = 'reserved'").run(b.id);
    db.prepare('UPDATE bottles SET status = ? WHERE id = ?').run(status, b.id);
    if (status === 'in_stock') db.prepare('UPDATE bottles SET out_reason = NULL, out_at = NULL WHERE id = ?').run(b.id);
    audit(db, { user, category: '庫存', action: '變更狀態' + (extra.tag || ''), obj_type: 'bottle', obj_id: no, obj_label: `${b.name} ${b.vintage}`, changes: { 狀態: [STATUS[b.status], STATUS[status]], ...(extra.changes || {}), ...(held ? { 取消保留: held.order_no } : {}) }, reason: clean(reason) || null, batch_id: extra.batch || null });
    n++;
  }
  return { changed: n };
}

// 移動（網頁與手機離線同步共用）
export function moveItems(db, body, user, extra = {}) {
  const { what, case_no, bottle_nos = [], dest = {}, note } = body || {};
  const batch = extra.batch || 'MV-' + Date.now().toString(36).toUpperCase();
  const tag = extra.tag || '';
  const more = extra.changes || {};
  if (what === 'case') {
    const c = db.prepare('SELECT * FROM cases WHERE case_no = ?').get(case_no) || bad('找不到酒箱 ' + case_no);
    const rack = db.prepare('SELECT * FROM racks WHERE id = ?').get(Number(dest.rack_id)) || bad('請選擇目的地架子');
    if (rack.id === c.rack_id && !c.location_uncertain) bad('酒箱已經在這個位置');
    const from = locationLabel(db, c.rack_id) + (c.location_uncertain ? '（待確認）' : '');
    db.prepare('UPDATE cases SET rack_id = ?, location_uncertain = 0 WHERE id = ?').run(rack.id, c.id);
    const n = db.prepare('UPDATE bottles SET rack_id = ? WHERE case_id = ?').run(rack.id, c.id).changes;
    const to = locationLabel(db, rack.id);
    audit(db, { user, category: '庫存', action: '移動酒箱' + tag, obj_type: 'case', obj_id: c.case_no, obj_label: to, changes: { 位置: [from, to], 瓶數: n, ...more }, reason: clean(note) || null, batch_id: batch });
    return { moved: n, to };
  }
  if (what !== 'bottles') bad('請選擇要移動的項目');
  if (!bottle_nos.length) bad('請掃描或輸入瓶號');
  const bottles = bottle_nos.map((no) => db.prepare(`SELECT b.*, w.name, w.vintage, w.wine_no, c.case_no FROM bottles b JOIN wines w ON w.id = b.wine_id
    LEFT JOIN cases c ON c.id = b.case_id WHERE b.bottle_no = ?`).get(no) || bad('找不到瓶號 ' + no));
  const out = bottles.find((b) => b.status !== 'in_stock' && b.status !== 'reserved');
  if (out) bad(`瓶號 ${out.bottle_no} 不在庫，不能移動`);
  const d = resolveDest(db, dest);
  if (d.caseId && bottles.every((b) => b.case_id === d.caseId)) bad('酒瓶已經在這個酒箱');
  const upd = db.prepare('UPDATE bottles SET case_id = ?, rack_id = ? WHERE id = ?');
  for (const b of bottles) upd.run(d.caseId, d.rackId, b.id);
  // 依原位置分組寫紀錄
  const groups = new Map();
  for (const b of bottles) { const k = (b.case_no || 'R' + b.rack_id) + '|' + b.wine_no; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  for (const list of groups.values()) {
    const b0 = list[0];
    const from = (b0.case_no ? `酒箱 ${b0.case_no}` : '散瓶') + ' @ ' + locationLabel(db, b0.rack_id);
    const to = (d.caseNo ? `酒箱 ${d.caseNo}` : '散瓶') + ' @ ' + d.label;
    audit(db, { user, category: '庫存', action: (d.created ? '裝入新酒箱' : '移動酒瓶') + tag, obj_type: 'wine', obj_id: b0.wine_no, obj_label: `${b0.name} ${b0.vintage}`,
      changes: { 位置: [from, to], 瓶數: list.length, 瓶號: list.map((b) => b.bottle_no).join(', '), ...more }, reason: clean(note) || null, batch_id: batch });
  }
  const count = d.caseId ? db.prepare("SELECT COUNT(*) n FROM bottles WHERE case_id = ? AND status = 'in_stock'").get(d.caseId).n : null;
  return { moved: bottles.length, to: d.label, case_no: d.caseNo, warning: d.capacity && count > d.capacity ? `酒箱 ${d.caseNo} 現有 ${count} 瓶，超過容量 ${d.capacity}` : null };
}

export function wineIdsFrom(db, src) {
  if (src.query) {
    const { from, p } = buildSearch(src.query);
    return db.prepare(`SELECT w.id ${from} GROUP BY w.id ORDER BY w.winery, w.name, w.vintage`).all(p).map((r) => r.id);
  }
  const ids = new Set();
  for (const no of src.wine_nos || []) { const w = db.prepare('SELECT id FROM wines WHERE wine_no = ?').get(no); if (w) ids.add(w.id); }
  for (const code of src.codes || []) {
    const c = clean(code).replace(/^MW:/i, '').replace(/^(?:CASE|C):/i, '');
    const lk = c.match(/^(LOCKER|RACK):(\d+)$/i);
    if (lk) {
      const sql = lk[1].toUpperCase() === 'LOCKER' ? "SELECT DISTINCT b.wine_id FROM bottles b JOIN racks k ON k.id = b.rack_id WHERE k.locker_id = ? AND b.status = 'in_stock'" : "SELECT DISTINCT wine_id FROM bottles WHERE rack_id = ? AND status = 'in_stock'";
      for (const x of db.prepare(sql).all(Number(lk[2]))) ids.add(x.wine_id);
      continue;
    }
    const r = db.prepare('SELECT wine_id FROM bottles WHERE bottle_no = ?').get(c.toUpperCase())
      || db.prepare('SELECT id wine_id FROM wines WHERE wine_no = ?').get(c.toUpperCase());
    if (r) ids.add(r.wine_id);
    else for (const x of db.prepare("SELECT DISTINCT b.wine_id FROM bottles b JOIN cases cs ON cs.id = b.case_id WHERE cs.case_no = ? AND b.status = 'in_stock'").all(c)) ids.add(x.wine_id);
  }
  return [...ids];
}
export function addItems(db, listId, ids) {
  const max = db.prepare('SELECT COALESCE(MAX(pos), 0) m FROM list_items WHERE list_id = ?').get(listId).m;
  const ins = db.prepare('INSERT OR IGNORE INTO list_items (list_id, wine_id, pos) VALUES (?, ?, ?)');
  let n = 0;
  ids.forEach((id, i) => { n += ins.run(listId, id, max + i + 1).changes; });
  db.prepare("UPDATE lists SET updated_at = datetime('now','localtime') WHERE id = ?").run(listId);
  return n;
}
export function createList(db, b, user, extra = {}) {
  const name = clean(b.name) || bad('請輸入清單名稱');
  const ids = wineIdsFrom(db, b);
  const id = db.prepare('INSERT INTO lists (name, note, source, query, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(name, clean(b.note) || null, b.query ? 'search' : b.codes ? 'scan' : 'manual', b.query ? JSON.stringify(b.query) : null, user).lastInsertRowid;
  const n = addItems(db, id, ids);
  audit(db, { user, category: '清單', action: '建立清單' + (extra.tag || ''), obj_type: 'list', obj_id: String(id), obj_label: name, changes: { 酒款: n, ...(extra.changes || {}) } });
  return { id, added: n };
}

export function addPrice(db, wine, b, user, extra = {}) {
  const price = intOrNull(b.price);
  if (!price || price < 0) bad('請輸入市場價格');
  const date = b.date || today();
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) bad('日期格式需為 YYYY-MM-DD');
  const prev = db.prepare(`SELECT price FROM price_history WHERE wine_id = ? AND voided = 0 ORDER BY effective_date DESC, id DESC LIMIT 1`).get(wine.id);
  const id = db.prepare('INSERT INTO price_history (wine_id, price, effective_date, source, url, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(wine.id, price, date, clean(b.source) || '手動輸入', b.url || null, user).lastInsertRowid;
  audit(db, { user, category: '價格', action: '更新市場價格' + (extra.tag || ''), obj_type: 'wine', obj_id: wine.wine_no, obj_label: `${wine.name} ${wine.vintage}`,
    changes: { 市場價格: [prev?.price ?? null, price], 日期: date, 來源: clean(b.source) || '手動輸入', ...(b.url ? { 網址: b.url } : {}) }, batch_id: extra.batch || null });
  return { id, price, date };
}

export const SETTINGS_DEFAULTS = {
  company: { name_zh: '示範酒業有限公司', name_en: 'Demo Wine Co., Ltd.', tax_id: '12345678', phone: '02-2345-6789', address: '台北市信義區示範路 1 號', email: 'info@example.com', tax_rate: '5', logo: '' },
  label: { printer: 'TSC TTP-247', bottle_size: '62x29', big_size: '100x62' },
  price: { site: 'Wine-Searcher', currency: 'TWD', url_template: 'https://www.wine-searcher.com/find/{name}+{vintage}/1/taiwan', stale_days: '30', per_hour: '100', per_day: '300', min_wait: '10', max_wait: '20', order_markup: '0' },
};
export function readSettings(db) {
  const out = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
  for (const r of db.prepare('SELECT key, value FROM settings').all()) { const [g, k] = r.key.split('.'); if (out[g]) out[g][k] = r.value; }
  return out;
}

export function mountM2(app, db) {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const U = (req) => req.user.login;
  const tx = (fn) => db.transaction(fn)();
  const wineBy = (no) => db.prepare('SELECT * FROM wines WHERE wine_no = ?').get(no) || notFound('找不到酒款 ' + no);

  // ===== 酒款 =====
  app.get('/api/wines-similar', h((req) => {
    const q = req.query;
    if (!q.winery || !q.name) return [];
    const key = wineKey({ winery: q.winery, name: q.name, vintage: String(q.vintage || 'NV').toUpperCase(), volume: Number(q.volume || 750) });
    const exact = db.prepare(`SELECT w.wine_no, w.name, w.vintage, w.volume_ml, (SELECT COUNT(*) FROM bottles b WHERE b.wine_id = w.id AND b.status = 'in_stock') qty
      FROM wines w WHERE match_key = ?`).all(key);
    return exact;
  }));

  app.post('/api/wines', h((req) => tx(() => {
    const b = req.body || {};
    const w = normWine(b.wine || {});
    for (const k of ['winery', 'name']) if (!w[k]) bad(`請填寫${WINE_FIELDS[k]}`);
    if (!w.type_code) bad('請選擇種類');
    w.vintage ||= 'NV';
    w.volume_ml ||= 750;
    const key = wineKey({ ...w, volume: w.volume_ml });
    if (db.prepare('SELECT 1 FROM wines WHERE match_key = ?').get(key)) throw new HttpError(409, '這款酒已存在，請改用「加入庫存」');
    const wine_no = nextNo(db, 'wine', 'W-', 6);
    const cols = { ...Object.fromEntries(Object.keys(WINE_FIELDS).map((k) => [k, w[k] ?? null])), wine_no, match_key: key, search_key: searchKey({ ...w, wine_no }), created_by: U(req) };
    const id = db.prepare(`INSERT INTO wines (${Object.keys(cols).join(',')}) VALUES (${Object.keys(cols).map((k) => '@' + k).join(',')})`).run(cols).lastInsertRowid;
    const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(id);
    audit(db, { user: U(req), category: '酒款', action: '新增酒款', obj_type: 'wine', obj_id: wine_no, obj_label: `${wine.name} ${wine.vintage}` });
    const out = { wine_no };
    if (b.stock?.qty) Object.assign(out, stockIn(db, wine, b.stock, U(req)));
    if (b.price?.price) addPrice(db, wine, b.price, U(req));
    return out;
  })));

  app.put('/api/wines/:no', h((req) => tx(() => {
    const old = wineBy(req.params.no);
    const w = normWine(req.body || {});
    if ('winery' in w && !w.winery) bad('請填寫酒莊');
    if ('name' in w && !w.name) bad('請填寫品名');
    const next = { ...old, ...w };
    const changes = {};
    for (const k of Object.keys(w)) if ((old[k] ?? null) !== (w[k] ?? null) && String(old[k] ?? '') !== String(w[k] ?? '')) changes[WINE_FIELDS[k]] = [old[k] ?? null, w[k] ?? null];
    if (!Object.keys(changes).length) return { wine_no: old.wine_no, changed: 0 };
    const key = wineKey({ ...next, volume: next.volume_ml });
    const dup = db.prepare('SELECT wine_no FROM wines WHERE match_key = ? AND id <> ?').get(key, old.id);
    if (dup) throw new HttpError(409, `修改後會和 ${dup.wine_no} 重複`);
    db.prepare(`UPDATE wines SET ${Object.keys(w).map((k) => `${k} = @${k}`).join(', ')}, match_key = @match_key, search_key = @search_key,
      updated_by = @user, updated_at = datetime('now','localtime') WHERE id = @id`).run({ ...w, match_key: key, search_key: searchKey(next), user: U(req), id: old.id });
    audit(db, { user: U(req), category: '酒款', action: '修改酒款', obj_type: 'wine', obj_id: old.wine_no, obj_label: `${next.name} ${next.vintage}`, changes, reason: req.body.reason || null });
    return { wine_no: old.wine_no, changed: Object.keys(changes).length };
  })));

  app.post('/api/wines/:no/stock', h((req) => tx(() => stockIn(db, wineBy(req.params.no), req.body || {}, U(req)))));

  app.post('/api/wines/:no/prices', h((req) => tx(() => addPrice(db, wineBy(req.params.no), req.body || {}, U(req)))));
  app.post('/api/prices/:id/void', h((req) => tx(() => {
    const p = db.prepare('SELECT p.*, w.wine_no, w.name, w.vintage FROM price_history p JOIN wines w ON w.id = p.wine_id WHERE p.id = ?').get(Number(req.params.id)) || notFound('找不到價格紀錄');
    if (!clean(req.body?.reason)) bad('請填寫作廢原因');
    db.prepare('UPDATE price_history SET voided = 1 WHERE id = ?').run(p.id);
    audit(db, { user: U(req), category: '價格', action: '作廢價格', obj_type: 'wine', obj_id: p.wine_no, obj_label: `${p.name} ${p.vintage}`, changes: { 市場價格: p.price, 日期: p.effective_date }, reason: clean(req.body.reason) });
    return { ok: true };
  })));

  // 照片
  app.get('/api/wines/:no/photos', h((req) => db.prepare('SELECT id, file, is_main FROM photos WHERE wine_id = ? ORDER BY is_main DESC, id').all(wineBy(req.params.no).id)));
  app.post('/api/wines/:no/photos', upload.array('photos', 10), h((req) => tx(() => {
    const w = wineBy(req.params.no);
    if (!req.files?.length) bad('請選擇照片');
    const has = db.prepare('SELECT COUNT(*) n FROM photos WHERE wine_id = ?').get(w.id).n;
    const out = [];
    req.files.forEach((f, i) => {
      if (!/^image\//.test(f.mimetype)) bad('只接受圖片檔');
      const ext = (path.extname(Buffer.from(f.originalname, 'latin1').toString('utf8')) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
      const file = `${w.wine_no}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(PHOTO_DIR, file), f.buffer);
      db.prepare('INSERT INTO photos (wine_id, file, is_main, created_by) VALUES (?, ?, ?, ?)').run(w.id, file, has === 0 && i === 0 ? 1 : 0, U(req));
      out.push(file);
    });
    audit(db, { user: U(req), category: '酒款', action: '上傳照片', obj_type: 'wine', obj_id: w.wine_no, obj_label: `${w.name} ${w.vintage}`, changes: { 照片: out.length } });
    return { files: out };
  })));
  app.put('/api/photos/:id/main', h((req) => tx(() => {
    const p = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id)) || notFound('找不到照片');
    db.prepare('UPDATE photos SET is_main = (id = ?) WHERE wine_id = ?').run(p.id, p.wine_id);
    return { ok: true };
  })));
  app.delete('/api/photos/:id', h((req) => tx(() => {
    const p = db.prepare('SELECT p.*, w.wine_no, w.name, w.vintage FROM photos p JOIN wines w ON w.id = p.wine_id WHERE p.id = ?').get(Number(req.params.id)) || notFound('找不到照片');
    db.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
    fs.rmSync(path.join(PHOTO_DIR, p.file), { force: true });
    if (p.is_main) db.prepare('UPDATE photos SET is_main = 1 WHERE id = (SELECT MIN(id) FROM photos WHERE wine_id = ?)').run(p.wine_id);
    audit(db, { user: U(req), category: '酒款', action: '刪除照片', obj_type: 'wine', obj_id: p.wine_no, obj_label: `${p.name} ${p.vintage}` });
    return { ok: true };
  })));
  app.get('/api/photo/:file', (req, res) => {
    const f = path.basename(req.params.file);
    const full = path.join(PHOTO_DIR, f);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(full);
  });

  // ===== 酒瓶狀態 =====
  app.post('/api/bottles/status', h((req) => tx(() => setStatus(db, req.body || {}, U(req)))));

  // ===== 酒箱 =====
  app.put('/api/cases/:no', h((req) => tx(() => {
    const c = db.prepare('SELECT * FROM cases WHERE case_no = ?').get(req.params.no) || notFound('找不到酒箱');
    const b = req.body || {};
    const next = { capacity: 'capacity' in b ? intOrNull(b.capacity) : c.capacity, note: 'note' in b ? clean(b.note) || null : c.note,
      kind: 'kind' in b ? clean(b.kind) || null : c.kind, location_uncertain: 'location_uncertain' in b ? (b.location_uncertain ? 1 : 0) : c.location_uncertain };
    const L = { capacity: '容量', note: '備註', kind: '類型', location_uncertain: '位置待確認' };
    const changes = {};
    for (const k of Object.keys(next)) if ((c[k] ?? null) !== (next[k] ?? null)) changes[L[k]] = [c[k], next[k]];
    if (!Object.keys(changes).length) return { changed: 0 };
    db.prepare('UPDATE cases SET capacity = @capacity, note = @note, kind = @kind, location_uncertain = @location_uncertain WHERE id = @id').run({ ...next, id: c.id });
    audit(db, { user: U(req), category: '庫存', action: '修改酒箱', obj_type: 'case', obj_id: c.case_no, obj_label: locationLabel(db, c.rack_id), changes });
    return { changed: Object.keys(changes).length };
  })));
  app.get('/api/next-case-no', h(() => ({ case_no: newCaseNo(db) })));

  // ===== 移動 =====
  // { what: 'case', case_no, dest: { rack_id } }
  // { what: 'bottles', bottle_nos: [], dest: { mode: 'case'|'newcase'|'loose', rack_id, case_no, capacity } }
  app.post('/api/move', h((req) => tx(() => moveItems(db, req.body, U(req)))));

  // 掃描／輸入代碼 → 物件
  app.get('/api/resolve/:code', h((req) => {
    const raw = clean(req.params.code);
    const code = raw.replace(/^MW:/i, '');
    let m;
    if ((m = code.match(/^(?:RACK|R):(\d+)$/i))) {
      const r = db.prepare(`SELECT k.id, k.code, k.locker_id, l.code locker, ce.name cellar FROM racks k JOIN lockers l ON l.id = k.locker_id JOIN cellars ce ON ce.id = l.cellar_id WHERE k.id = ?`).get(Number(m[1]));
      return r ? { type: 'rack', ...r, label: `${r.cellar} › ${r.locker} › ${r.code}` } : notFound('找不到架子');
    }
    if ((m = code.match(/^(?:LOCKER|L):(\d+)$/i))) {
      const l = db.prepare('SELECT l.id, l.code, ce.name cellar FROM lockers l JOIN cellars ce ON ce.id = l.cellar_id WHERE l.id = ?').get(Number(m[1]));
      return l ? { type: 'locker', ...l, label: `${l.cellar} › ${l.code}` } : notFound('找不到分儲空間');
    }
    const caseNo = code.replace(/^(?:CASE|C):/i, '');
    const c = db.prepare('SELECT case_no, rack_id FROM cases WHERE case_no = ?').get(caseNo);
    if (c) {
      const bottles = db.prepare(`SELECT b.bottle_no, b.status, w.wine_no, w.name, w.vintage FROM bottles b JOIN wines w ON w.id = b.wine_id WHERE b.case_id = (SELECT id FROM cases WHERE case_no = ?) AND b.status IN ('in_stock', 'reserved') ORDER BY b.bottle_no`).all(caseNo);
      return { type: 'case', case_no: c.case_no, rack_id: c.rack_id, label: locationLabel(db, c.rack_id), bottles };
    }
    const b = db.prepare(`SELECT b.bottle_no, b.status, b.rack_id, w.wine_no, w.name, w.vintage, c.case_no FROM bottles b JOIN wines w ON w.id = b.wine_id LEFT JOIN cases c ON c.id = b.case_id WHERE b.bottle_no = ?`).get(code.toUpperCase());
    if (b) return { type: 'bottle', ...b, label: locationLabel(db, b.rack_id) };
    const w = db.prepare('SELECT wine_no, name, vintage FROM wines WHERE wine_no = ?').get(code.toUpperCase());
    if (w) return { type: 'wine', ...w };
    notFound('找不到「' + raw + '」');
  }));

  // ===== 儲位管理 =====
  app.get('/api/locations', h(() => {
    const cellars = db.prepare('SELECT * FROM cellars ORDER BY name').all();
    const lockers = db.prepare('SELECT * FROM lockers').all().sort((a, b) => a.code.localeCompare(b.code, 'zh-Hant', { numeric: true }));
    const racks = db.prepare(`SELECT k.*, (SELECT COUNT(*) FROM bottles b WHERE b.rack_id = k.id AND b.status = 'in_stock') n,
      (SELECT COUNT(*) FROM cases c WHERE c.rack_id = k.id) cases FROM racks k ORDER BY is_default DESC, code`).all();
    return cellars.map((c) => ({ ...c, lockers: lockers.filter((l) => l.cellar_id === c.id).map((l) => ({ ...l, racks: racks.filter((r) => r.locker_id === l.id) })) }));
  }));
  const LOC = {
    cellars: { label: '酒窖', fields: ['name', 'kind', 'address', 'note'], required: ['name'], show: (r) => r.name },
    lockers: { label: '分儲空間', fields: ['cellar_id', 'code', 'note'], required: ['cellar_id', 'code'], show: (r) => r.code },
    racks: { label: '架子', fields: ['locker_id', 'code', 'note'], required: ['locker_id', 'code'], show: (r) => r.code },
  };
  for (const [table, cfg] of Object.entries(LOC)) {
    app.post(`/api/${table}`, h((req) => tx(() => {
      const b = req.body || {};
      const row = Object.fromEntries(cfg.fields.map((f) => [f, typeof b[f] === 'string' ? clean(b[f]) || null : b[f] ?? null]));
      for (const f of cfg.required) if (!row[f]) bad('請填寫必填欄位');
      if (table === 'cellars') row.kind ||= 'general';
      const id = db.prepare(`INSERT INTO ${table} (${cfg.fields.join(',')}) VALUES (${cfg.fields.map((f) => '@' + f).join(',')})`).run(row).lastInsertRowid;
      if (table === 'lockers') db.prepare('INSERT INTO racks (locker_id, code, is_default) VALUES (?, ?, 1)').run(id, '未指定');
      audit(db, { user: U(req), category: '設定', action: '新增' + cfg.label, obj_type: table.slice(0, -1), obj_id: String(id), obj_label: cfg.show(row) });
      return { id };
    })));
    app.put(`/api/${table}/:id`, h((req) => tx(() => {
      const old = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(req.params.id)) || notFound('找不到' + cfg.label);
      const b = req.body || {};
      const editable = cfg.fields.filter((f) => !f.endsWith('_id') && f in b);
      const changes = {};
      for (const f of editable) { const v = clean(b[f]) || null; if ((old[f] ?? null) !== v) changes[f] = [old[f], v]; }
      if (!Object.keys(changes).length) return { changed: 0 };
      if (cfg.required.some((f) => f in changes && !changes[f][1])) bad('必填欄位不能空白');
      db.prepare(`UPDATE ${table} SET ${Object.keys(changes).map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({ ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])), id: old.id });
      audit(db, { user: U(req), category: '設定', action: '修改' + cfg.label, obj_type: table.slice(0, -1), obj_id: String(old.id), obj_label: cfg.show({ ...old, ...b }), changes });
      return { changed: Object.keys(changes).length };
    })));
    app.delete(`/api/${table}/:id`, h((req) => tx(() => {
      const id = Number(req.params.id);
      const old = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || notFound('找不到' + cfg.label);
      const used = table === 'racks' ? db.prepare('SELECT (SELECT COUNT(*) FROM bottles WHERE rack_id = ?) + (SELECT COUNT(*) FROM cases WHERE rack_id = ?) n').get(id, id).n
        : table === 'lockers' ? db.prepare('SELECT COUNT(*) n FROM bottles b JOIN racks k ON k.id = b.rack_id WHERE k.locker_id = ?').get(id).n
          : db.prepare('SELECT COUNT(*) n FROM lockers WHERE cellar_id = ?').get(id).n;
      if (used) bad(`${cfg.label}不是空的，不能刪除`);
      if (table === 'lockers') db.prepare('DELETE FROM racks WHERE locker_id = ?').run(id);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      audit(db, { user: U(req), category: '設定', action: '刪除' + cfg.label, obj_type: table.slice(0, -1), obj_id: String(id), obj_label: cfg.show(old) });
      return { ok: true };
    })));
  }

  // ===== 清單 =====
  const listStats = `SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) wines,
    (SELECT COUNT(*) FROM list_items i JOIN bottles b ON b.wine_id = i.wine_id AND b.status = 'in_stock' WHERE i.list_id = l.id) bottles FROM lists l`;
  app.get('/api/lists', h(() => db.prepare(listStats + ' ORDER BY COALESCE(updated_at, created_at) DESC').all()));

  function listDetail(id) {
    const l = db.prepare(listStats + ' WHERE l.id = ?').get(id) || notFound('找不到清單');
    const items = db.prepare(`SELECT i.pos, i.note, w.id wine_id, w.wine_no, w.winery, w.name, w.vintage, w.region, w.volume_ml, w.suggested_price, t.zh type_zh, t.en type_en,
      (SELECT COUNT(*) FROM bottles b WHERE b.wine_id = w.id AND b.status = 'in_stock') qty,
      (SELECT GROUP_CONCAT(DISTINCT lk.code) FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN lockers lk ON lk.id = k.locker_id WHERE b.wine_id = w.id AND b.status = 'in_stock') lockers,
      ${latestPrice} price, ${latestDate} price_date
      FROM list_items i JOIN wines w ON w.id = i.wine_id LEFT JOIN wine_types t ON t.code = w.type_code WHERE i.list_id = ? ORDER BY i.pos, i.id`).all(id);
    const priced = items.filter((i) => i.price != null);
    const stale = db.prepare(`SELECT date('now','localtime','-${SQL.STALE_DAYS} days') d`).get().d;
    return { ...l, items, avgPrice: priced.length ? Math.round(priced.reduce((s, i) => s + i.price, 0) / priced.length) : null, staleBefore: stale };
  }
  app.get('/api/lists/:id', h((req) => listDetail(Number(req.params.id))));

  app.post('/api/lists', h((req) => tx(() => createList(db, req.body || {}, U(req)))));
  app.put('/api/lists/:id', h((req) => tx(() => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(Number(req.params.id)) || notFound('找不到清單');
    const name = 'name' in req.body ? clean(req.body.name) || bad('請輸入清單名稱') : l.name;
    const note = 'note' in req.body ? clean(req.body.note) || null : l.note;
    db.prepare("UPDATE lists SET name = ?, note = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(name, note, l.id);
    if (Array.isArray(req.body.order)) {
      const upd = db.prepare('UPDATE list_items SET pos = ? WHERE list_id = ? AND wine_id = (SELECT id FROM wines WHERE wine_no = ?)');
      req.body.order.forEach((no, i) => upd.run(i + 1, l.id, no));
    }
    return { ok: true };
  })));
  app.delete('/api/lists/:id', h((req) => tx(() => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(Number(req.params.id)) || notFound('找不到清單');
    db.prepare('DELETE FROM list_items WHERE list_id = ?').run(l.id);
    db.prepare('DELETE FROM lists WHERE id = ?').run(l.id);
    audit(db, { user: U(req), category: '清單', action: '刪除清單', obj_type: 'list', obj_id: String(l.id), obj_label: l.name });
    return { ok: true };
  })));
  app.post('/api/lists/:id/items', h((req) => tx(() => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(Number(req.params.id)) || notFound('找不到清單');
    const ids = wineIdsFrom(db, req.body || {});
    if (!ids.length) bad('找不到要加入的酒款');
    return { added: addItems(db, l.id, ids) };
  })));
  app.delete('/api/lists/:id/items/:wineNo', h((req) => tx(() => {
    const r = db.prepare('DELETE FROM list_items WHERE list_id = ? AND wine_id = (SELECT id FROM wines WHERE wine_no = ?)').run(Number(req.params.id), req.params.wineNo);
    db.prepare("UPDATE lists SET updated_at = datetime('now','localtime') WHERE id = ?").run(Number(req.params.id));
    return { removed: r.changes };
  })));
  app.post('/api/lists/:id/copy', h((req) => tx(() => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(Number(req.params.id)) || notFound('找不到清單');
    const name = clean(req.body?.name) || l.name + '（複製）';
    const id = db.prepare('INSERT INTO lists (name, note, source, query, created_by) VALUES (?, ?, ?, ?, ?)').run(name, l.note, l.source, l.query, U(req)).lastInsertRowid;
    db.prepare('INSERT INTO list_items (list_id, wine_id, pos, note) SELECT ?, wine_id, pos, note FROM list_items WHERE list_id = ?').run(id, l.id);
    audit(db, { user: U(req), category: '清單', action: '複製清單', obj_type: 'list', obj_id: String(id), obj_label: name, changes: { 來源: l.name } });
    return { id };
  })));

  // ===== 標籤 =====
  // kind: bottle | case | rack | locker；來源：bottle_nos / case_nos / list / query / unprinted / rack_ids / locker_ids
  app.post('/api/labels', h((req) => {
    const b = req.body || {};
    const kind = b.kind || 'bottle';
    const bottleSel = `SELECT b.bottle_no, b.label_printed_at, w.wine_no, w.winery, w.name, w.vintage, w.volume_ml, c.case_no, l.code locker, ce.name cellar`;
    const bottleFrom = `FROM bottles b JOIN wines w ON w.id = b.wine_id JOIN racks k ON k.id = b.rack_id JOIN lockers l ON l.id = k.locker_id JOIN cellars ce ON ce.id = l.cellar_id LEFT JOIN cases c ON c.id = b.case_id`;
    if (kind === 'bottle') {
      let rows;
      if (b.unprinted) rows = db.prepare(`${bottleSel} ${bottleFrom} WHERE b.status = 'in_stock' AND b.label_printed_at IS NULL ORDER BY b.bottle_no LIMIT 2000`).all();
      else if (b.bottle_nos) rows = b.bottle_nos.map((no) => db.prepare(`${bottleSel} ${bottleFrom} WHERE b.bottle_no = ?`).get(no)).filter(Boolean);
      else if (b.case_nos) rows = db.prepare(`${bottleSel} ${bottleFrom} WHERE b.status = 'in_stock' AND c.case_no IN (${b.case_nos.map(() => '?').join(',') || 'NULL'}) ORDER BY b.bottle_no`).all(...b.case_nos);
      else {
        const ids = b.list ? db.prepare('SELECT wine_id FROM list_items WHERE list_id = ? ORDER BY pos').all(Number(b.list)).map((r) => r.wine_id) : wineIdsFrom(db, { query: b.query || {} });
        rows = ids.length ? db.prepare(`${bottleSel} ${bottleFrom} WHERE b.status = 'in_stock' AND w.id IN (${ids.join(',')}) ORDER BY w.winery, w.name, b.bottle_no`).all() : [];
      }
      if (b.only_unprinted) rows = rows.filter((r) => !r.label_printed_at);
      return { kind, labels: rows };
    }
    if (kind === 'case') {
      let caseIds;
      if (b.case_nos) caseIds = b.case_nos.map((no) => db.prepare('SELECT id FROM cases WHERE case_no = ?').get(no)?.id).filter(Boolean);
      else if (b.locker) caseIds = db.prepare('SELECT c.id FROM cases c JOIN racks k ON k.id = c.rack_id WHERE k.locker_id = ? ORDER BY c.case_no').all(Number(b.locker)).map((r) => r.id);
      else {
        const ids = b.list ? db.prepare('SELECT wine_id FROM list_items WHERE list_id = ?').all(Number(b.list)).map((r) => r.wine_id) : wineIdsFrom(db, { query: b.query || {} });
        caseIds = ids.length ? db.prepare(`SELECT DISTINCT case_id id FROM bottles WHERE status = 'in_stock' AND case_id IS NOT NULL AND wine_id IN (${ids.join(',')})`).all().map((r) => r.id) : [];
      }
      const labels = caseIds.map((id) => {
        const c = db.prepare('SELECT c.case_no, c.rack_id, c.capacity FROM cases c WHERE c.id = ?').get(id);
        const bs = db.prepare(`SELECT b.bottle_no, w.name, w.vintage FROM bottles b JOIN wines w ON w.id = b.wine_id WHERE b.case_id = ? AND b.status = 'in_stock' ORDER BY b.bottle_no`).all(id);
        const names = [...new Set(bs.map((x) => x.name))];
        const vintages = [...new Set(bs.map((x) => x.vintage))];
        return { case_no: c.case_no, location: locationLabel(db, c.rack_id), qty: bs.length, capacity: c.capacity, name: names.length > 1 ? `${names[0]} 等 ${names.length} 款` : names[0] || '（空箱）',
          vintage: vintages.join(' / '), first: bs[0]?.bottle_no, last: bs.at(-1)?.bottle_no };
      }).sort((a, b) => a.case_no.localeCompare(b.case_no));
      return { kind, labels };
    }
    if (kind === 'locker' || kind === 'rack') {
      const ids = (b[kind + '_ids'] || []).map(Number);
      const rows = kind === 'locker'
        ? db.prepare(`SELECT l.id, l.code, ce.name cellar FROM lockers l JOIN cellars ce ON ce.id = l.cellar_id ${ids.length ? `WHERE l.id IN (${ids.join(',')})` : ''}`).all()
        : db.prepare(`SELECT k.id, k.code, l.code locker, ce.name cellar FROM racks k JOIN lockers l ON l.id = k.locker_id JOIN cellars ce ON ce.id = l.cellar_id ${ids.length ? `WHERE k.id IN (${ids.join(',')})` : ''}`).all();
      rows.sort((a, b) => (a.locker || a.code).localeCompare(b.locker || b.code, 'zh-Hant', { numeric: true }) || a.code.localeCompare(b.code));
      return { kind, labels: rows };
    }
    bad('標籤類型不正確');
  }));
  app.post('/api/labels/printed', h((req) => tx(() => {
    const { kind = 'bottle', codes = [] } = req.body || {};
    if (!codes.length) return { marked: 0 };
    let n = 0;
    if (kind === 'bottle') {
      const upd = db.prepare("UPDATE bottles SET label_printed_at = datetime('now','localtime') WHERE bottle_no = ?");
      for (const c of codes) n += upd.run(c).changes;
    } else n = codes.length;
    audit(db, { user: U(req), category: '庫存', action: '列印標籤', obj_type: kind, obj_id: codes.length === 1 ? String(codes[0]) : null,
      obj_label: { bottle: '酒瓶小標', case: '酒箱標籤', locker: '分儲空間標籤', rack: '架子標籤' }[kind], changes: { 張數: codes.length, 範圍: codes.length > 1 ? `${codes[0]} – ${codes.at(-1)}` : String(codes[0]) } });
    return { marked: n };
  })));

  // ===== 匯出 =====
  const EXPORT_COLS = {
    wine_no: ['酒款編號', 'Wine no.'], winery: ['酒莊', 'Winery'], name: ['品名', 'Name'], vintage: ['年份', 'Vintage'], region: ['產區', 'Region'],
    country: ['國家', 'Country'], type: ['種類', 'Type'], volume_ml: ['容量 (ml)', 'Volume (ml)'], qty: ['瓶數', 'Bottles'],
    suggested_price: ['建議售價', 'Suggested price'], price: ['市場價格', 'Market price'], price_date: ['價格日期', 'Price date'],
    location: ['位置', 'Location'], cases: ['箱號', 'Cases'], cost: ['採購價格（平均）', 'Avg. purchase price'], merchants: ['酒商', 'Merchants'],
  };
  function exportRows(src) {
    let ids;
    let title;
    if (src.list) {
      const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(Number(src.list)) || notFound('找不到清單');
      ids = db.prepare('SELECT wine_id FROM list_items WHERE list_id = ? ORDER BY pos, id').all(l.id).map((r) => r.wine_id);
      title = l.name;
    } else { ids = wineIdsFrom(db, { query: src.query || {} }); title = null; }
    const one = db.prepare(`SELECT w.*, t.zh type_zh, t.en type_en, ${latestPrice} price, ${latestDate} price_date, (SELECT file FROM photos ph WHERE ph.wine_id = w.id ORDER BY is_main DESC, id LIMIT 1) photo FROM wines w LEFT JOIN wine_types t ON t.code = w.type_code WHERE w.id = ?`);
    const stock = db.prepare(`SELECT COUNT(*) qty, GROUP_CONCAT(DISTINCT ce.name || ' › ' || l.code) location, GROUP_CONCAT(DISTINCT c.case_no) cases,
      GROUP_CONCAT(DISTINCT m.name) merchants, ROUND(AVG(lot.purchase_price)) cost
      FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN lockers l ON l.id = k.locker_id JOIN cellars ce ON ce.id = l.cellar_id LEFT JOIN cases c ON c.id = b.case_id
      LEFT JOIN lots lot ON lot.id = b.lot_id LEFT JOIN merchants m ON m.id = lot.merchant_id WHERE b.wine_id = ? AND b.status = 'in_stock'`);
    const rows = ids.map((id) => { const w = one.get(id); const s = stock.get(id); return { ...w, ...s, cost: s.cost == null ? null : Number(s.cost) }; });
    return { rows, title };
  }
  function exportLog(req, fmt, n, b) {
    audit(db, { user: U(req), category: '匯出', action: '匯出' + fmt, obj_type: b.list ? 'list' : 'search', obj_id: b.list ? String(b.list) : null,
      obj_label: b.title || (b.list ? '清單' : '搜尋結果'), changes: { 酒款: n, 含採購價格: b.columns?.includes('cost') ? '是' : '否', 語言: b.lang === 'en' ? 'English' : '中文' } });
  }
  app.post('/api/export/data', h((req) => {
    const b = req.body || {};
    const { rows, title } = exportRows(b);
    if (b.log) exportLog(req, ' PDF', rows.length, { ...b, title });
    return { rows, title, company: getSettings().company, columns: EXPORT_COLS };
  }));
  app.post('/api/export/xlsx', h(async (req, res) => {
    const b = req.body || {};
    const { rows, title } = exportRows(b);
    const lang = b.lang === 'en' ? 1 : 0;
    const cols = (b.columns?.length ? b.columns : ['winery', 'name', 'vintage', 'region', 'qty', 'price']).filter((c) => EXPORT_COLS[c]);
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(lang ? 'Wines' : '酒款');
    const company = getSettings().company;
    ws.addRow([lang ? company.name_en : company.name_zh]).font = { bold: true, size: 14 };
    ws.addRow([(title ? title + ' · ' : '') + today()]);
    ws.addRow([]);
    const head = ws.addRow(cols.map((c) => EXPORT_COLS[c][lang]));
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2342' } }; });
    for (const r of rows) ws.addRow(cols.map((c) => (c === 'type' ? (lang ? r.type_en : r.type_zh) : r[c] ?? '')));
    const money = ['price', 'cost', 'suggested_price'];
    cols.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = { name: 44, winery: 24, location: 28, cases: 24, merchants: 16 }[c] || 12; if (money.includes(c)) col.numFmt = '#,##0'; });
    const totalRow = ws.addRow(cols.map((c, i) => (i === 0 ? (lang ? 'Total' : '合計') : c === 'qty' ? rows.reduce((s, r) => s + r.qty, 0) : '')));
    totalRow.font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    exportLog(req, ' Excel', rows.length, { ...b, title });
    const buf = await wb.xlsx.writeBuffer();
    const fname = `${title || (lang ? 'wines' : '酒款')}-${today()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.end(Buffer.from(buf));
  }));

  // ===== 設定 =====
  const DEFAULTS = SETTINGS_DEFAULTS;
  const getSettings = () => readSettings(db);
  app.get('/api/settings', h(() => getSettings()));
  app.put('/api/settings/:group', h((req) => tx(() => {
    const g = req.params.group;
    if (!DEFAULTS[g]) bad('設定群組不正確');
    const cur = getSettings()[g];
    const changes = {};
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of Object.keys(DEFAULTS[g])) if (k in req.body && k !== 'logo') {
      const v = clean(req.body[k]);
      if (g === 'label' && k.endsWith('_size') && !/^\d{2,3}x\d{2,3}$/.test(v)) bad('標籤尺寸格式不正確（例如 50x30）');
      if (g === 'price' && k === 'url_template' && v && !/^https?:\/\//.test(v)) bad('網址需以 http:// 或 https:// 開頭');
      if (String(cur[k] ?? '') !== v) { changes[k] = [cur[k], v]; up.run(`${g}.${k}`, v); }
    }
    if (Object.keys(changes).length) audit(db, { user: U(req), category: '設定', action: { company: '修改公司資料', price: '修改查價設定', label: '修改標籤設定' }[g], obj_type: 'settings', obj_id: g, obj_label: { company: '公司資料', price: '查價設定', label: '標籤設定' }[g], changes });
    return getSettings();
  })));
  app.post('/api/settings/logo', upload.single('logo'), h((req) => tx(() => {
    if (!req.file || !/^image\//.test(req.file.mimetype)) bad('請選擇 PNG / SVG / JPG 圖檔');
    const ext = { 'image/svg+xml': '.svg', 'image/png': '.png', 'image/jpeg': '.jpg' }[req.file.mimetype] || '.png';
    const file = 'logo-' + crypto.randomBytes(3).toString('hex') + ext;
    fs.writeFileSync(path.join(PHOTO_DIR, file), req.file.buffer);
    db.prepare("INSERT INTO settings (key, value) VALUES ('company.logo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(file);
    audit(db, { user: U(req), category: '設定', action: '更新公司 Logo', obj_type: 'settings', obj_id: 'company', obj_label: '公司資料' });
    return { logo: file };
  })));

  // 使用者（密碼不會出現在任何回應或紀錄）
  const userCols = 'id, login, name, lang, active, last_login, locked_until';
  app.get('/api/users', h(() => db.prepare(`SELECT ${userCols} FROM users ORDER BY active DESC, login`).all()));
  const checkPw = (pw) => (/^\d{6}$/.test(String(pw || '')) ? String(pw) : bad('密碼需為 6 位數字'));
  const checkLogin = (s) => { const v = clean(s); if (!/^[A-Za-z0-9._-]{2,32}$/.test(v)) bad('登入名稱需為 2–32 個英文字母、數字或 . _ -'); return v; };
  app.post('/api/users', h((req) => tx(() => {
    const b = req.body || {};
    const login = checkLogin(b.login);
    const id = db.prepare('INSERT INTO users (login, name, pw_hash, lang) VALUES (?, ?, ?, ?)').run(login, clean(b.name) || null, bcrypt.hashSync(checkPw(b.password), 10), b.lang === 'en' ? 'en' : 'zh').lastInsertRowid;
    audit(db, { user: U(req), category: '設定', action: '新增使用者', obj_type: 'user', obj_id: login, obj_label: clean(b.name) || login });
    return { id };
  })));
  app.put('/api/users/:id', h((req) => tx(() => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)) || notFound('找不到使用者');
    const b = req.body || {};
    const next = { name: 'name' in b ? clean(b.name) || null : u.name, lang: 'lang' in b ? (b.lang === 'en' ? 'en' : 'zh') : u.lang, active: 'active' in b ? (b.active ? 1 : 0) : u.active };
    if (u.active && !next.active) {
      if (db.prepare('SELECT COUNT(*) n FROM users WHERE active = 1').get().n <= 1) bad('至少要保留一位啟用中的使用者');
      if (u.id === req.user.id) bad('不能停用自己');
    }
    const L = { name: '姓名', lang: '介面語言', active: '狀態' };
    const changes = {};
    for (const k of Object.keys(next)) if ((u[k] ?? null) !== next[k]) changes[L[k]] = k === 'active' ? [u[k] ? '啟用' : '停用', next[k] ? '啟用' : '停用'] : [u[k], next[k]];
    if (!Object.keys(changes).length) return { changed: 0 };
    db.prepare('UPDATE users SET name = @name, lang = @lang, active = @active WHERE id = @id').run({ ...next, id: u.id });
    if (!next.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, { user: U(req), category: '設定', action: next.active === u.active ? '修改使用者' : next.active ? '啟用使用者' : '停用使用者', obj_type: 'user', obj_id: u.login, obj_label: next.name || u.login, changes });
    return { changed: Object.keys(changes).length };
  })));
  app.post('/api/users/:id/password', h((req) => tx(() => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)) || notFound('找不到使用者');
    db.prepare('UPDATE users SET pw_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(checkPw(req.body?.password), 10), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(u.id, req.sid || '');
    audit(db, { user: U(req), category: '設定', action: u.id === req.user.id ? '變更自己的密碼' : '重設密碼', obj_type: 'user', obj_id: u.login, obj_label: u.name || u.login });
    return { ok: true };
  })));

  // 客戶
  const CUST = ['name', 'kind', 'tax_id', 'contact', 'phone', 'email', 'address', 'lang', 'discount', 'note', 'active'];
  const CUST_L = { name: '名稱', kind: '類型', tax_id: '統一編號', contact: '聯絡人', phone: '電話', email: 'Email', address: '地址', lang: '偏好語言', discount: '預設折扣', note: '備註', active: '狀態' };
  const custRow = (b, old = {}) => {
    const r = {};
    for (const k of CUST) r[k] = k in b ? (k === 'discount' ? (b[k] === '' || b[k] == null ? null : Number(b[k])) : k === 'active' ? (b[k] ? 1 : 0) : clean(b[k]) || null) : old[k] ?? null;
    r.kind ||= '個人'; r.lang = r.lang === 'en' ? 'en' : 'zh'; if (r.active == null) r.active = 1;
    if (!r.name) bad('請填寫客戶名稱');
    if (r.discount != null && !(r.discount >= 0 && r.discount <= 100)) bad('折扣需為 0–100');
    return r;
  };
  app.get('/api/customers', h(() => db.prepare('SELECT * FROM customers ORDER BY active DESC, customer_no').all()));
  app.post('/api/customers', h((req) => tx(() => {
    const r = custRow(req.body || {});
    const no = nextNo(db, 'customer', 'C-', 4);
    const id = db.prepare(`INSERT INTO customers (customer_no, ${CUST.join(',')}) VALUES (@customer_no, ${CUST.map((k) => '@' + k).join(',')})`).run({ ...r, customer_no: no }).lastInsertRowid;
    audit(db, { user: U(req), category: '設定', action: '新增客戶', obj_type: 'customer', obj_id: no, obj_label: r.name });
    return { id, customer_no: no };
  })));
  app.put('/api/customers/:id', h((req) => tx(() => {
    const old = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id)) || notFound('找不到客戶');
    const r = custRow(req.body || {}, old);
    const changes = {};
    for (const k of CUST) if ((old[k] ?? null) !== (r[k] ?? null)) changes[CUST_L[k]] = [old[k], r[k]];
    if (!Object.keys(changes).length) return { changed: 0 };
    db.prepare(`UPDATE customers SET ${CUST.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...r, id: old.id });
    audit(db, { user: U(req), category: '設定', action: '修改客戶', obj_type: 'customer', obj_id: old.customer_no, obj_label: r.name, changes });
    return { changed: Object.keys(changes).length };
  })));

  // 酒商
  app.get('/api/merchants', h(() => db.prepare(`SELECT m.*, (SELECT COUNT(DISTINCT b.case_id) FROM lots lot JOIN bottles b ON b.lot_id = lot.id AND b.status = 'in_stock' WHERE lot.merchant_id = m.id) cases,
    (SELECT COUNT(*) FROM lots lot JOIN bottles b ON b.lot_id = lot.id AND b.status = 'in_stock' WHERE lot.merchant_id = m.id) bottles FROM merchants m ORDER BY m.name`).all()));
  const MER = ['name', 'kind', 'contact', 'phone', 'email', 'note'];
  app.post('/api/merchants', h((req) => tx(() => {
    const r = Object.fromEntries(MER.map((k) => [k, clean(req.body?.[k]) || null]));
    if (!r.name) bad('請填寫酒商名稱');
    const id = db.prepare(`INSERT INTO merchants (${MER.join(',')}) VALUES (${MER.map((k) => '@' + k).join(',')})`).run(r).lastInsertRowid;
    audit(db, { user: U(req), category: '設定', action: '新增酒商', obj_type: 'merchant', obj_id: String(id), obj_label: r.name });
    return { id };
  })));
  app.put('/api/merchants/:id', h((req) => tx(() => {
    const old = db.prepare('SELECT * FROM merchants WHERE id = ?').get(Number(req.params.id)) || notFound('找不到酒商');
    const r = Object.fromEntries(MER.map((k) => [k, k in (req.body || {}) ? clean(req.body[k]) || null : old[k]]));
    if (!r.name) bad('請填寫酒商名稱');
    const changes = {};
    for (const k of MER) if ((old[k] ?? null) !== r[k]) changes[k] = [old[k], r[k]];
    if (!Object.keys(changes).length) return { changed: 0 };
    db.prepare(`UPDATE merchants SET ${MER.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...r, id: old.id });
    audit(db, { user: U(req), category: '設定', action: '修改酒商', obj_type: 'merchant', obj_id: String(old.id), obj_label: r.name, changes });
    return { changed: Object.keys(changes).length };
  })));
  app.post('/api/merchants/merge', h((req) => tx(() => {
    const from = db.prepare('SELECT * FROM merchants WHERE id = ?').get(Number(req.body?.from_id)) || notFound('找不到酒商');
    const to = db.prepare('SELECT * FROM merchants WHERE id = ?').get(Number(req.body?.to_id)) || notFound('找不到酒商');
    if (from.id === to.id) bad('請選擇兩個不同的酒商');
    const n = db.prepare('UPDATE lots SET merchant_id = ? WHERE merchant_id = ?').run(to.id, from.id).changes;
    db.prepare('DELETE FROM merchants WHERE id = ?').run(from.id);
    audit(db, { user: U(req), category: '設定', action: '合併酒商', obj_type: 'merchant', obj_id: String(to.id), obj_label: `${from.name} → ${to.name}`, changes: { 採購批次: n } });
    return { moved: n };
  })));

  // 種類代碼
  app.get('/api/types', h(() => db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM bottles b JOIN wines w ON w.id = b.wine_id WHERE w.type_code = t.code AND b.status = 'in_stock') bottles,
    (SELECT COUNT(*) FROM wines w WHERE w.type_code = t.code) wines FROM wine_types t ORDER BY t.mapped DESC, t.rowid`).all()));
  app.post('/api/types', h((req) => tx(() => {
    const code = clean(req.body?.code).toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(code)) bad('匯入代碼需為 1–8 個英文字母或數字');
    const zh = clean(req.body?.zh) || bad('請填寫中文名稱'), en = clean(req.body?.en) || bad('請填寫英文名稱');
    db.prepare('INSERT INTO wine_types (code, zh, en, mapped) VALUES (?, ?, ?, 1)').run(code, zh, en);
    audit(db, { user: U(req), category: '設定', action: '新增種類', obj_type: 'type', obj_id: code, obj_label: `${zh} ${en}` });
    return { code };
  })));
  app.put('/api/types/:code', h((req) => tx(() => {
    const t = db.prepare('SELECT * FROM wine_types WHERE code = ?').get(req.params.code) || notFound('找不到種類');
    const b = req.body || {};
    if (b.merge_into) {
      const to = db.prepare('SELECT * FROM wine_types WHERE code = ?').get(b.merge_into) || bad('找不到目標種類');
      if (to.code === t.code) bad('請選擇不同的種類');
      const wines = db.prepare('SELECT id, wine_no, winery, name, vintage, region, country FROM wines WHERE type_code = ?').all(t.code);
      db.prepare('UPDATE wines SET type_code = ? WHERE type_code = ?').run(to.code, t.code);
      db.prepare('DELETE FROM wine_types WHERE code = ?').run(t.code);
      audit(db, { user: U(req), category: '設定', action: '種類對應', obj_type: 'type', obj_id: t.code, obj_label: `${t.code} → ${to.zh}`, changes: { 酒款: wines.length } });
      return { moved: wines.length };
    }
    const zh = clean(b.zh) || t.zh, en = clean(b.en) || t.en;
    const changes = {};
    if (zh !== t.zh) changes['中文'] = [t.zh, zh];
    if (en !== t.en) changes['English'] = [t.en, en];
    if (!t.mapped) changes['狀態'] = ['待對應', '已對應'];
    if (!Object.keys(changes).length) return { changed: 0 };
    db.prepare('UPDATE wine_types SET zh = ?, en = ?, mapped = 1 WHERE code = ?').run(zh, en, t.code);
    audit(db, { user: U(req), category: '設定', action: '修改種類', obj_type: 'type', obj_id: t.code, obj_label: `${zh} ${en}`, changes });
    return { changed: Object.keys(changes).length };
  })));

  mountBatch(app, db, { h, bad, tx, checkPw, checkLogin, custRow, CUST, MER, nextNo });

  app.use((err, _req, res, next) => (err instanceof HttpError ? res.status(err.status).json({ error: err.message }) : next(err)));
}
