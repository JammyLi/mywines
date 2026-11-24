// 設定 › 清除資料：清空庫存、訂單、使用者、客戶、酒窖、異動紀錄
// 兩道確認：輸入「刪除＋項目名稱」＋自己的 6 位數密碼；刪除前自動備份整個資料庫
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { ROOT, audit } from './db.js';
import { lanAddresses } from './tls.js';
import { h, bad, HttpError, PHOTO_DIR, readSettings } from './m2.js';

const DATA = () => process.env.MYWINES_DATA || path.join(ROOT, 'data');
const n = (db, sql, ...a) => db.prepare(sql).get(...a).c;

export const SCOPES = {
  inventory: { label: '庫存', desc: '所有酒款、酒箱、瓶號、採購批次、市場價格、照片、清單、盤點紀錄；也會一併刪除所有訂單（訂單需要酒款）。酒窖與架子保留。' },
  orders: { label: '訂單', desc: '所有訂單與明細；被保留的酒瓶會放回在庫。已出貨的酒瓶維持「已出貨」。' },
  users: { label: '使用者', desc: '除了你自己以外的所有使用者帳號。你的帳號保留，否則沒有人能登入。' },
  customers: { label: '客戶', desc: '所有客戶與送貨地址。還有訂單時不能刪除，請先清空訂單。' },
  cellars: { label: '酒窖', desc: '所有酒窖、分儲空間、架子。還有酒箱或酒瓶時不能刪除，請先清空庫存。' },
  logs: { label: '異動紀錄', desc: '所有異動紀錄。清除後會留下一筆「誰在何時清除」的紀錄。' },
};

function counts(db, me) {
  return {
    inventory: { wines: n(db, 'SELECT COUNT(*) c FROM wines'), bottles: n(db, 'SELECT COUNT(*) c FROM bottles'), cases: n(db, 'SELECT COUNT(*) c FROM cases'), orders: n(db, 'SELECT COUNT(*) c FROM orders'), lists: n(db, 'SELECT COUNT(*) c FROM lists') },
    orders: { orders: n(db, 'SELECT COUNT(*) c FROM orders'), reserved: n(db, "SELECT COUNT(*) c FROM bottles WHERE status = 'reserved'") },
    users: { users: n(db, 'SELECT COUNT(*) c FROM users WHERE id <> ?', me) },
    customers: { customers: n(db, 'SELECT COUNT(*) c FROM customers'), orders: n(db, 'SELECT COUNT(*) c FROM orders WHERE customer_id IS NOT NULL') },
    cellars: { cellars: n(db, 'SELECT COUNT(*) c FROM cellars'), lockers: n(db, 'SELECT COUNT(*) c FROM lockers'), racks: n(db, 'SELECT COUNT(*) c FROM racks'), bottles: n(db, 'SELECT COUNT(*) c FROM bottles') + n(db, 'SELECT COUNT(*) c FROM cases') },
    logs: { logs: n(db, 'SELECT COUNT(*) c FROM audit_log') },
  };
}
function blocker(scope, c) {
  if (scope === 'customers' && c.customers.orders) return `還有 ${c.customers.orders} 張訂單使用這些客戶，請先清空訂單。`;
  if (scope === 'cellars' && c.cellars.bottles) return '還有酒箱或酒瓶放在這些儲位，請先清空庫存。';
  return null;
}
const stamp = () => { const d = new Date(), p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

// 異動紀錄保存期限：超過 N 個月的自動刪除（0 = 不自動刪除）
const olderThan = (months) => `ts < datetime('now','localtime','-${Number(months)} months')`;
export function purgeOldLogs(db, user = 'system') {
  const months = Number(readSettings(db).logs?.retain_months || 0);
  if (![3, 6, 12].includes(months)) return 0;
  const n = db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE ${olderThan(months)}`).get().c;
  if (!n) return 0;
  db.transaction(() => {
    db.exec(`DROP TRIGGER IF EXISTS audit_no_delete; DELETE FROM audit_log WHERE ${olderThan(months)};`);
    db.exec("CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is read-only'); END;");
    audit(db, { user, category: '設定', action: '自動刪除舊異動紀錄', obj_type: 'admin', obj_id: 'logs', obj_label: `保存 ${months} 個月`, changes: { 刪除筆數: n } });
  })();
  return n;
}

export function mountAdmin(app, db, opts = {}) {
  purgeOldLogs(db);
  const timer = setInterval(() => { try { purgeOldLogs(db); } catch (e) { console.error('自動刪除異動紀錄失敗', e.message); } }, 60 * 60 * 1000);
  timer.unref?.();
  app.get('/api/admin/logs-retention', h((req) => {
    const months = Number(req.query.months ?? readSettings(db).logs?.retain_months ?? 0);
    const cur = Number(readSettings(db).logs?.retain_months || 0);
    const total = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
    const oldest = db.prepare('SELECT MIN(ts) t FROM audit_log').get().t;
    const wouldDelete = [3, 6, 12].includes(months) ? db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE ${olderThan(months)}`).get().c : 0;
    return { months: cur, total, oldest, wouldDelete };
  }));
  app.post('/api/admin/logs-retention', h((req) => {
    const months = String(req.body?.months ?? '');
    if (!['0', '3', '6', '12'].includes(months)) bad('保存期限只能選 3、6、12 個月或不自動刪除');
    const old = String(readSettings(db).logs?.retain_months || '0');
    if (old !== months) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('logs.retain_months', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(months);
      audit(db, { user: req.user.login, category: '設定', action: '修改紀錄保存期限', obj_type: 'settings', obj_id: 'logs', obj_label: '異動紀錄保存期限', changes: { 保存期限: [old === '0' ? '不自動刪除' : old + ' 個月', months === '0' ? '不自動刪除' : months + ' 個月'] } });
    }
    return { months: Number(months), deleted: purgeOldLogs(db, req.user.login) };
  }));
  // 連線位址：給其他電腦與手機用的網址（需登入）
  app.get('/api/server-info', h(() => {
    const http = opts.httpPort || 3000, https = opts.httpsPort || 3443;
    const ips = lanAddresses();
    return { ips, httpPort: http, httpsPort: opts.caPath ? https : null, urls: ips.map((ip) => ({ ip, pc: `http://${ip}:${http}`, phone: opts.caPath ? `https://${ip}:${https}/m` : null, setup: `http://${ip}:${http}/setup` })) };
  }));
  const U = (req) => req.user.login;

  app.get('/api/admin/clear', h((req) => {
    const c = counts(db, req.user.id);
    return Object.fromEntries(Object.entries(SCOPES).map(([k, s]) => [k, { ...s, counts: c[k], blocked: blocker(k, c), phrase: '刪除' + s.label }]));
  }));

  app.post('/api/admin/clear', h(async (req) => {
    const { scope, phrase, password } = req.body || {};
    const S = SCOPES[scope] || bad('請選擇要清除的項目');
    // 第一道：輸入確認文字
    if (String(phrase || '').trim() !== '刪除' + S.label) bad(`請輸入「刪除${S.label}」確認`);
    // 第二道：自己的密碼
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!/^\d{6}$/.test(String(password || '')) || !bcrypt.compareSync(String(password), me.pw_hash)) throw new HttpError(403, '密碼不正確，沒有刪除任何資料');
    const c = counts(db, me.id);
    const block = blocker(scope, c);
    if (block) bad(block);
    // 刪除前備份
    const dir = path.join(DATA(), 'backup');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `mywines-${stamp()}-清除${S.label}前.db`);
    await db.backup(backup);
    const photos = scope === 'inventory' ? db.prepare('SELECT file FROM photos').all().map((r) => r.file) : [];
    const result = db.transaction(() => {
      if (scope === 'orders' || scope === 'inventory') {
        db.prepare("UPDATE bottles SET status = 'in_stock' WHERE status = 'reserved' AND id IN (SELECT bottle_id FROM order_bottles WHERE state = 'reserved')").run();
        db.exec('DELETE FROM order_bottles; DELETE FROM order_lines; DELETE FROM orders;');
      }
      if (scope === 'inventory') {
        db.exec(`DELETE FROM list_items; DELETE FROM lists; DELETE FROM stocktakes; DELETE FROM offline_ops; DELETE FROM photos; DELETE FROM price_lookups;
          DELETE FROM price_history; DELETE FROM bottles; DELETE FROM lots; DELETE FROM cases; DELETE FROM wines; DELETE FROM import_batches;`);
        // 編號不歸零：已貼在酒瓶上的舊標籤不會和新酒瓶撞號
      }
      if (scope === 'users') {
        db.prepare('DELETE FROM sessions WHERE user_id <> ?').run(me.id);
        db.prepare('DELETE FROM users WHERE id <> ?').run(me.id);
      }
      if (scope === 'customers') db.exec('DELETE FROM customer_addresses; DELETE FROM customers;');
      if (scope === 'cellars') db.exec('DELETE FROM racks; DELETE FROM lockers; DELETE FROM cellars;');
      if (scope === 'logs') {
        // 異動紀錄平時不能刪改；這裡暫時解除，清除後立刻恢復
        db.exec('DROP TRIGGER IF EXISTS audit_no_delete; DELETE FROM audit_log;');
        db.exec("CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is read-only'); END;");
      }
      audit(db, { user: U(req), category: '設定', action: '清除' + S.label, obj_type: 'admin', obj_id: scope, obj_label: '清除資料', changes: { ...c[scope], 備份: path.basename(backup) } });
      return c[scope];
    })();
    for (const f of photos) fs.rmSync(path.join(PHOTO_DIR, f), { force: true });
    return { ok: true, scope, deleted: result, backup: path.basename(backup) };
  }));
}
