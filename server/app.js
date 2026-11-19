import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, audit } from './db.js';
import { parseWorkbook, summarize, commitImport, norm } from './importer.js';
import { mountM2, readSettings, PHOTO_DIR } from './m2.js';
import { mountStockout } from './stockout.js';
import { mountM3 } from './m3.js';
import { mountOrders } from './orders.js';
import { setupPage } from './setup.js';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
import { buildSearch, latestPrice, latestDate, STALE_DAYS } from './search.js';

function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

export function createApp(db, opts = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  const pendingImports = new Map();

  // ---------- 登入 ----------
  app.use((req, _res, next) => {
    const sid = parseCookies(req.headers.cookie).sid;
    if (sid) {
      const s = db.prepare(`SELECT u.id, u.login, u.name, u.lang FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now','localtime') AND u.active = 1`).get(sid);
      if (s) { req.user = s; req.sid = sid; }
    }
    next();
  });

  // 手機設定（不需登入）：下載本機憑證、開啟 HTTPS 網址
  app.get('/ca.crt', (_req, res) => {
    if (!opts.caPath || !fs.existsSync(opts.caPath)) return res.status(404).send('尚未建立憑證');
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="mywines-ca.crt"');
    res.send(fs.readFileSync(opts.caPath));
  });
  app.get('/setup', async (req, res) => res.type('html').send(await setupPage(req, opts)));
  // 公司名稱與 Logo（登入畫面也要顯示，不需登入）
  app.get('/api/public/company', (_req, res) => { const c = readSettings(db).company; res.json({ name_zh: c.name_zh, name_en: c.name_en, logo: c.logo }); });
  app.get('/api/public/logo', (_req, res) => {
    const f = readSettings(db).company.logo;
    const full = f && path.join(PHOTO_DIR, path.basename(f));
    if (!full || !fs.existsSync(full)) return res.status(404).end();
    res.sendFile(full);
  });

  app.post('/api/login', (req, res) => {
    const { login = '', password = '', remember = true } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE login = ?').get(String(login).trim());
    const fail = (msg, code = 401) => res.status(code).json({ error: msg });
    if (!u || !u.active) return fail('登入名稱或密碼錯誤');
    if (u.locked_until && u.locked_until > db.prepare("SELECT datetime('now','localtime') t").get().t)
      return fail(`錯誤次數過多，請於 ${u.locked_until.slice(11, 16)} 後再試`, 423);
    if (!/^\d{6}$/.test(String(password)) || !bcrypt.compareSync(String(password), u.pw_hash)) {
      const n = u.failed_count + 1;
      if (n >= LOCK_AFTER) {
        db.prepare(`UPDATE users SET failed_count = 0, locked_until = datetime('now','localtime','+${LOCK_MINUTES} minutes') WHERE id = ?`).run(u.id);
        return fail(`連續錯誤 ${LOCK_AFTER} 次，已鎖定 ${LOCK_MINUTES} 分鐘`, 423);
      }
      db.prepare('UPDATE users SET failed_count = ? WHERE id = ?').run(n, u.id);
      return fail(`登入名稱或密碼錯誤（還可再試 ${LOCK_AFTER - n} 次）`);
    }
    const token = crypto.randomBytes(24).toString('hex');
    const days = remember ? 30 : 1;
    db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now','localtime','+${days} days'))`).run(token, u.id);
    db.prepare("UPDATE users SET failed_count = 0, locked_until = NULL, last_login = datetime('now','localtime') WHERE id = ?").run(u.id);
    res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}`);
    res.json({ login: u.login, name: u.name, lang: u.lang });
  });

  app.post('/api/logout', (req, res) => {
    const sid = parseCookies(req.headers.cookie).sid;
    if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
    res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => (req.user ? next() : res.status(401).json({ error: '請先登入' })));

  app.get('/api/me', (req, res) => res.json(req.user));

  app.put('/api/me/lang', (req, res) => {
    const lang = req.body?.lang === 'en' ? 'en' : 'zh';
    db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, req.user.id);
    res.json({ lang });
  });

  // ---------- 總覽 ----------
  app.get('/api/dashboard', (_req, res) => {
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const bottles = one("SELECT COUNT(*) c FROM bottles WHERE status = 'in_stock'").c;
    const reserved = one("SELECT COUNT(*) c FROM bottles WHERE status = 'reserved'").c;
    const openOrders = one("SELECT COUNT(*) c FROM orders WHERE status IN ('draft','confirmed')").c;
    const cases = one("SELECT COUNT(DISTINCT case_id) c FROM bottles WHERE status = 'in_stock' AND case_id IS NOT NULL").c;
    const wines = one("SELECT COUNT(DISTINCT wine_id) c FROM bottles WHERE status = 'in_stock'").c;
    const lockers = one("SELECT COUNT(DISTINCT k.locker_id) c FROM bottles b JOIN racks k ON k.id = b.rack_id WHERE b.status = 'in_stock'").c;
    const value = one(`SELECT COALESCE(SUM(${latestPrice}), 0) v FROM bottles b JOIN wines w ON w.id = b.wine_id WHERE b.status = 'in_stock'`).v;
    const stale = one(`SELECT COUNT(*) c FROM (SELECT w.id, ${latestDate} d FROM wines w WHERE EXISTS (SELECT 1 FROM bottles b WHERE b.wine_id = w.id AND b.status = 'in_stock'))
      WHERE d IS NULL OR d < date('now','localtime','-${STALE_DAYS} days')`).c;
    const uncertain = one('SELECT COUNT(*) c FROM cases WHERE location_uncertain = 1').c;
    const byType = all(`SELECT COALESCE(t.zh, '未分類') label, t.mapped mapped, COUNT(*) n FROM bottles b JOIN wines w ON w.id = b.wine_id
      LEFT JOIN wine_types t ON t.code = w.type_code WHERE b.status = 'in_stock' GROUP BY w.type_code ORDER BY n DESC`);
    const byLocker = all(`SELECT l.id, c.name cellar, l.code, COUNT(*) n FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN lockers l ON l.id = k.locker_id
      JOIN cellars c ON c.id = l.cellar_id WHERE b.status = 'in_stock' GROUP BY l.id ORDER BY n DESC LIMIT 6`);
    const recent = all('SELECT ts, user_login, category, action, obj_label FROM audit_log ORDER BY id DESC LIMIT 6');
    const unmapped = all(`SELECT t.code, COUNT(b.id) n FROM wine_types t LEFT JOIN wines w ON w.type_code = t.code LEFT JOIN bottles b ON b.wine_id = w.id AND b.status = 'in_stock'
      WHERE t.mapped = 0 GROUP BY t.code`);
    const uncertainCases = all(`SELECT c.case_no, w.name, c.note FROM cases c JOIN bottles b ON b.case_id = c.id JOIN wines w ON w.id = b.wine_id
      WHERE c.location_uncertain = 1 GROUP BY c.id LIMIT 5`);
    res.json({ bottles, reserved, openOrders, cases, wines, lockers, value, stale, uncertain, byType, byLocker, recent, unmapped, uncertainCases });
  });

  // ---------- 篩選選項 ----------
  app.get('/api/filters', (_req, res) => {
    res.json({
      types: db.prepare('SELECT code, zh, en, mapped FROM wine_types ORDER BY mapped DESC, rowid').all(),
      lockers: db.prepare('SELECT l.id, c.name cellar, l.code FROM lockers l JOIN cellars c ON c.id = l.cellar_id').all()
        .sort((a, b) => a.cellar.localeCompare(b.cellar) || a.code.localeCompare(b.code, 'zh-Hant', { numeric: true })),
      merchants: db.prepare('SELECT id, name FROM merchants ORDER BY name').all(),
      regions: db.prepare("SELECT DISTINCT region FROM wines WHERE region <> '' ORDER BY region").all().map((r) => r.region),
      wineries: db.prepare("SELECT DISTINCT winery FROM wines WHERE winery <> '' ORDER BY winery").all().map((r) => r.winery),
      countries: db.prepare("SELECT DISTINCT country FROM wines WHERE country <> '' ORDER BY country").all().map((r) => r.country),
    });
  });

  // 篩選選項依目前其他條件計算（每個欄位排除自己的條件），附瓶數
  app.get('/api/facets', (req, res) => {
    const q = { ...req.query };
    delete q.page; delete q.sort; delete q.view;
    const run = (omit, sql) => { const qq = { ...q }; for (const k of omit) delete qq[k]; const { from, p } = buildSearch(qq); return db.prepare(sql.replace('@FROM', from)).all(p); };
    res.json({
      types: run(['type'], 'SELECT w.type_code code, COUNT(*) n @FROM GROUP BY w.type_code'),
      regions: run(['region'], "SELECT w.region region, COUNT(*) n @FROM AND COALESCE(w.region, '') <> '' GROUP BY w.region ORDER BY w.region"),
      lockers: run(['locker'], 'SELECT l.id id, COUNT(*) n @FROM GROUP BY l.id'),
      merchants: run(['merchant'], 'SELECT lot.merchant_id id, COUNT(*) n @FROM AND lot.merchant_id IS NOT NULL GROUP BY lot.merchant_id'),
    });
  });

  // ---------- 搜尋 ----------
  app.get('/api/search', (req, res) => {
    const q = req.query;
    const { from, p } = buildSearch(q);
    const page = Math.max(1, Number(q.page) || 1), size = Math.min(200, Number(q.size) || 50);
    p.limit = size; p.offset = (page - 1) * size;
    const totals = db.prepare(`SELECT COUNT(DISTINCT w.id) wines, COUNT(DISTINCT c.id) cases, COUNT(*) bottles, COALESCE(SUM(${latestPrice}),0) value ${from}`).get(p);
    let rows;
    if (q.view === 'case') {
      const order = { case: 'c.case_no', locker: 'l.code, c.case_no', name: 'w.name' }[q.sort] || 'w.name, c.case_no';
      rows = db.prepare(`SELECT COALESCE(c.case_no, '散瓶') case_no, c.location_uncertain uncertain, ce.name cellar, l.code locker, k.code rack,
        w.wine_no, w.name, w.vintage, COUNT(*) qty, m.name merchant, lot.purchase_price cost, ${latestPrice} price ${from}
        GROUP BY COALESCE(c.id, 'r' || k.id), w.id, lot.id ORDER BY ${order} LIMIT @limit OFFSET @offset`).all(p);
      totals.rows = db.prepare(`SELECT COUNT(*) n FROM (SELECT 1 ${from} GROUP BY COALESCE(c.id, 'r' || k.id), w.id, lot.id)`).get(p).n;
    } else {
      const order = { price: 'price DESC', qty: 'qty DESC', vintage: 'w.vintage', date: 'price_date' }[q.sort] || 'w.winery, w.name, w.vintage';
      rows = db.prepare(`SELECT w.wine_no, w.winery, w.name, w.vintage, w.region, w.volume_ml, t.zh type_zh, t.en type_en, COUNT(*) qty,
        COUNT(DISTINCT c.id) case_count, GROUP_CONCAT(DISTINCT l.code) lockers, MAX(c.location_uncertain) uncertain,
        ${latestPrice} price, ${latestDate} price_date ${from} GROUP BY w.id ORDER BY ${order} LIMIT @limit OFFSET @offset`).all(p);
      totals.rows = totals.wines;
    }
    const staleBefore = db.prepare(`SELECT date('now','localtime','-${STALE_DAYS} days') d`).get().d;
    res.json({ totals, rows, page, size, staleBefore });
  });

  // ---------- 酒款明細 ----------
  app.get('/api/wines/:no', (req, res) => {
    const w = db.prepare(`SELECT w.*, t.zh type_zh, t.en type_en FROM wines w LEFT JOIN wine_types t ON t.code = w.type_code WHERE w.wine_no = ?`).get(req.params.no);
    if (!w) return res.status(404).json({ error: '找不到酒款' });
    const locations = db.prepare(`SELECT ce.name cellar, l.id locker_id, l.code locker, k.code rack, c.case_no, c.location_uncertain uncertain, c.note case_note,
      COUNT(*) qty, SUM(b.status = 'reserved') reserved, m.name merchant, lot.purchase_price cost FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN lockers l ON l.id = k.locker_id
      JOIN cellars ce ON ce.id = l.cellar_id LEFT JOIN cases c ON c.id = b.case_id LEFT JOIN lots lot ON lot.id = b.lot_id LEFT JOIN merchants m ON m.id = lot.merchant_id
      WHERE b.wine_id = ? AND b.status IN ('in_stock', 'reserved') GROUP BY COALESCE(c.id, 'r' || k.id), lot.id ORDER BY l.code, c.case_no`).all(w.id);
    const bottles = db.prepare(`SELECT b.bottle_no, b.status, b.out_reason, b.label_printed_at, ce.name cellar, l.code locker, k.code rack, c.case_no
      FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN lockers l ON l.id = k.locker_id JOIN cellars ce ON ce.id = l.cellar_id
      LEFT JOIN cases c ON c.id = b.case_id WHERE b.wine_id = ? ORDER BY b.bottle_no`).all(w.id);
    const prices = db.prepare('SELECT id, price, effective_date, source, url, voided, created_by FROM price_history WHERE wine_id = ? ORDER BY effective_date DESC, id DESC').all(w.id);
    const caseNos = [...new Set(locations.map((x) => x.case_no).filter(Boolean))];
    const logs = db.prepare(`SELECT ts, user_login, category, action, obj_label, changes FROM audit_log
      WHERE (obj_type = 'wine' AND obj_id = ?) ${caseNos.length ? `OR (obj_type = 'case' AND obj_id IN (${caseNos.map(() => '?').join(',')}))` : ''}
      ORDER BY id DESC LIMIT 50`).all(w.wine_no, ...caseNos);
    const costs = locations.filter((x) => x.cost != null);
    const qty = locations.reduce((s, x) => s + x.qty, 0);
    const costQty = costs.reduce((s, x) => s + x.qty, 0);
    const avgCost = costQty ? Math.round(costs.reduce((s, x) => s + x.cost * x.qty, 0) / costQty) : null;
    const price = prices.find((x) => !x.voided) || null;
    const reserved = locations.reduce((s, x) => s + (x.reserved || 0), 0);
    res.json({ wine: w, locations, bottles, prices, logs, qty, reserved, avgCost, costQty, price });
  });

  // ---------- 酒箱 ----------
  app.get('/api/cases/:no', (req, res) => {
    const c = db.prepare(`SELECT c.*, k.code rack, l.id locker_id, l.code locker, ce.name cellar FROM cases c JOIN racks k ON k.id = c.rack_id
      JOIN lockers l ON l.id = k.locker_id JOIN cellars ce ON ce.id = l.cellar_id WHERE c.case_no = ?`).get(req.params.no);
    if (!c) return res.status(404).json({ error: '找不到酒箱' });
    const bottles = db.prepare(`SELECT b.bottle_no, b.status, w.wine_no, w.name, w.vintage, m.name merchant, lot.purchase_price cost, ${latestPrice} price
      FROM bottles b JOIN wines w ON w.id = b.wine_id LEFT JOIN lots lot ON lot.id = b.lot_id LEFT JOIN merchants m ON m.id = lot.merchant_id
      WHERE b.case_id = ? ORDER BY b.bottle_no`).all(c.id);
    const logs = db.prepare("SELECT ts, user_login, category, action, obj_label, changes FROM audit_log WHERE obj_type = 'case' AND obj_id = ? ORDER BY id DESC LIMIT 50").all(c.case_no);
    res.json({ case: c, bottles, logs });
  });

  app.get('/api/bottles/:no', (req, res) => {
    const b = db.prepare(`SELECT b.*, w.wine_no, w.name, w.vintage, w.volume_ml, t.zh type_zh, ce.name cellar, l.code locker, k.code rack, c.case_no,
      m.name merchant, lot.purchase_price cost, ${latestPrice} price, ${latestDate} price_date FROM bottles b JOIN wines w ON w.id = b.wine_id
      LEFT JOIN wine_types t ON t.code = w.type_code JOIN racks k ON k.id = b.rack_id JOIN lockers l ON l.id = k.locker_id JOIN cellars ce ON ce.id = l.cellar_id
      LEFT JOIN cases c ON c.id = b.case_id LEFT JOIN lots lot ON lot.id = b.lot_id LEFT JOIN merchants m ON m.id = lot.merchant_id WHERE b.bottle_no = ?`).get(req.params.no);
    if (!b) return res.status(404).json({ error: '找不到瓶號' });
    res.json(b);
  });

  // ---------- 儲位 ----------
  app.get('/api/storage', (_req, res) => {
    const cellars = db.prepare('SELECT * FROM cellars ORDER BY name').all();
    const lockers = db.prepare(`SELECT l.id, l.cellar_id, l.code, (SELECT COUNT(*) FROM bottles b JOIN racks k ON k.id = b.rack_id WHERE k.locker_id = l.id AND b.status = 'in_stock') n,
      (SELECT COUNT(*) FROM cases c JOIN racks k ON k.id = c.rack_id WHERE k.locker_id = l.id AND c.location_uncertain = 1) uncertain FROM lockers l ORDER BY l.code`).all();
    lockers.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hant', { numeric: true }));
    res.json({ cellars: cellars.map((c) => ({ ...c, lockers: lockers.filter((l) => l.cellar_id === c.id), n: lockers.filter((l) => l.cellar_id === c.id).reduce((s, l) => s + l.n, 0) })) });
  });

  app.get('/api/lockers/:id', (req, res) => {
    const l = db.prepare('SELECT l.*, c.name cellar FROM lockers l JOIN cellars c ON c.id = l.cellar_id WHERE l.id = ?').get(Number(req.params.id));
    if (!l) return res.status(404).json({ error: '找不到分儲空間' });
    const racks = db.prepare('SELECT * FROM racks WHERE locker_id = ? ORDER BY is_default DESC, code').all(l.id);
    const cases = db.prepare(`SELECT c.case_no, c.rack_id, c.capacity, c.location_uncertain uncertain, c.note, COUNT(b.id) qty,
      GROUP_CONCAT(DISTINCT w.name) wines, GROUP_CONCAT(DISTINCT w.vintage) vintages, GROUP_CONCAT(DISTINCT m.name) merchants
      FROM cases c JOIN racks k ON k.id = c.rack_id LEFT JOIN bottles b ON b.case_id = c.id AND b.status = 'in_stock' LEFT JOIN wines w ON w.id = b.wine_id
      LEFT JOIN lots lot ON lot.id = b.lot_id LEFT JOIN merchants m ON m.id = lot.merchant_id WHERE k.locker_id = ? GROUP BY c.id ORDER BY c.case_no`).all(l.id);
    const loose = db.prepare(`SELECT b.bottle_no, b.rack_id, w.name, w.vintage FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN wines w ON w.id = b.wine_id
      WHERE k.locker_id = ? AND b.case_id IS NULL AND b.status = 'in_stock'`).all(l.id);
    const stats = db.prepare(`SELECT COUNT(*) bottles, COALESCE(SUM(${latestPrice}),0) value FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN wines w ON w.id = b.wine_id
      WHERE k.locker_id = ? AND b.status = 'in_stock'`).get(l.id);
    res.json({ locker: l, racks: racks.map((r) => ({ ...r, cases: cases.filter((c) => c.rack_id === r.id), loose: loose.filter((b) => b.rack_id === r.id) })), stats, caseCount: cases.length });
  });

  // ---------- 異動紀錄 ----------
  app.get('/api/audit', (req, res) => {
    const q = req.query;
    const where = ['1=1'];
    const p = {};
    if (q.user) { p.user = q.user; where.push('user_login = @user'); }
    if (q.from) { p.from = q.from; where.push('ts >= @from'); }
    if (q.to) { p.to = q.to + ' 23:59:59'; where.push('ts <= @to'); }
    if (q.cat) { const c = String(q.cat).split(',').filter(Boolean); where.push(`category IN (${c.map((_, i) => '@c' + i).join(',')})`); c.forEach((v, i) => (p['c' + i] = v)); }
    if (q.q) { p.q = '%' + q.q + '%'; where.push('(obj_id LIKE @q OR obj_label LIKE @q OR action LIKE @q OR changes LIKE @q OR batch_id LIKE @q)'); }
    const page = Math.max(1, Number(q.page) || 1);
    p.limit = 50; p.offset = (page - 1) * 50;
    const total = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE ${where.join(' AND ')}`).get(p).n;
    const rows = db.prepare(`SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT @limit OFFSET @offset`).all(p);
    const users = db.prepare('SELECT DISTINCT user_login FROM audit_log ORDER BY user_login').all().map((r) => r.user_login);
    res.json({ total, rows, page, users });
  });

  // ---------- 匯入 ----------
  app.post('/api/import/preview', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇 Excel 檔' });
      const parsed = await parseWorkbook(req.file.buffer);
      const token = crypto.randomBytes(12).toString('hex');
      const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      pendingImports.set(token, { parsed, filename, at: Date.now() });
      for (const [k, v] of pendingImports) if (Date.now() - v.at > 3600e3) pendingImports.delete(k);
      res.json({ token, filename, summary: summarize(db, parsed), suggestions: parsed.suggestions, issues: parsed.issues, sample: parsed.rows.slice(0, 15) });
    } catch (e) {
      res.status(400).json({ error: '無法讀取檔案：' + e.message });
    }
  });

  app.post('/api/import/summary', (req, res) => {
    const pend = pendingImports.get(req.body?.token);
    if (!pend) return res.status(410).json({ error: '預覽已過期，請重新上傳' });
    res.json(summarize(db, pend.parsed, req.body.merges));
  });

  app.post('/api/import/commit', (req, res) => {
    const pend = pendingImports.get(req.body?.token);
    if (!pend) return res.status(410).json({ error: '預覽已過期，請重新上傳' });
    const result = commitImport(db, pend.parsed, { merges: req.body.merges || pend.parsed.merges, user: req.user.login, filename: pend.filename });
    pendingImports.delete(req.body.token);
    res.json(result);
  });

  app.get('/api/imports', (_req, res) => {
    res.json(db.prepare('SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 20').all().map((r) => ({ ...r, summary: JSON.parse(r.summary || '{}') })));
  });

  mountM2(app, db);
  mountM3(app, db);
  mountOrders(app, db);
  mountStockout(app, db);

  // ---------- 前端 ----------
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: '系統錯誤：' + err.message }); });
  return app;
}
