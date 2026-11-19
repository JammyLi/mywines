import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export function openDb(file = process.env.MYWINES_DB || path.join(ROOT, 'data', 'mywines.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  seed(db);
  return db;
}

// 舊資料庫升級
function migrate(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(bottles)').all().map((c) => c.name));
  if (!cols.has('out_reason')) db.exec('ALTER TABLE bottles ADD COLUMN out_reason TEXT');
  if (!cols.has('out_at')) db.exec('ALTER TABLE bottles ADD COLUMN out_at TEXT');
  // 查價上限：每小時 20 → 100、每天 100 → 300（只更新仍是舊預設值的設定）
  db.prepare("UPDATE settings SET value = '100' WHERE key = 'price.per_hour' AND value = '20'").run();
  db.prepare("UPDATE settings SET value = '300' WHERE key = 'price.per_day' AND value = '100'").run();
}

// 種類代碼：中英名稱依術語對照表
const TYPES = [
  ['CP', '香檳', 'Champagne'],
  ['R', '紅葡萄酒', 'Red Wine'],
  ['W', '白葡萄酒', 'White Wine'],
  ['ROSE', '粉紅葡萄酒', 'Rosé Wine'],
  ['SP', '氣泡酒', 'Sparkling Wine'],
  ['DES', '甜酒', 'Dessert Wine'],
  ['FOR', '加烈葡萄酒', 'Fortified Wine'],
  ['ORA', '橙酒', 'Orange Wine'],
];

function seed(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO wine_types (code, zh, en, mapped) VALUES (?, ?, ?, 1)');
  for (const t of TYPES) ins.run(...t);
  const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (n === 0) {
    // 初始帳號：登入名稱 jammy，密碼 123456
    db.prepare('INSERT INTO users (login, pw_hash) VALUES (?, ?)').run('jammy', bcrypt.hashSync('123456', 10));
    db.prepare("INSERT INTO audit_log (user_login, category, action, obj_type, obj_id, obj_label) VALUES ('system', '設定', '新增使用者', 'user', 'jammy', 'jammy（初始帳號）')").run();
  }
}

export function nextNo(db, name, prefix, width) {
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
  const v = (row ? row.value : 0) + 1;
  db.prepare('INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, v);
  return prefix + String(v).padStart(width, '0');
}

export function audit(db, entry) {
  db.prepare(`INSERT INTO audit_log (user_login, category, action, obj_type, obj_id, obj_label, changes, batch_id, reason)
    VALUES (@user, @category, @action, @obj_type, @obj_id, @obj_label, @changes, @batch_id, @reason)`).run({
    obj_type: null, obj_id: null, obj_label: null, batch_id: null, reason: null,
    ...entry,
    changes: entry.changes ? JSON.stringify(entry.changes) : null,
  });
}
