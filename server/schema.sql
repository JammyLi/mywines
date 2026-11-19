-- 酒類庫存管理系統 資料表
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  pw_hash TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'zh',
  active INTEGER NOT NULL DEFAULT 1,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

-- 儲位：酒窖 Cellar › 分儲空間 Locker › 架子 Rack
CREATE TABLE IF NOT EXISTS cellars (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'general',
  address TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS lockers (
  id INTEGER PRIMARY KEY,
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  code TEXT NOT NULL,
  note TEXT,
  UNIQUE (cellar_id, code)
);

CREATE TABLE IF NOT EXISTS racks (
  id INTEGER PRIMARY KEY,
  locker_id INTEGER NOT NULL REFERENCES lockers(id),
  code TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  UNIQUE (locker_id, code)
);

CREATE TABLE IF NOT EXISTS merchants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT,
  contact TEXT,
  phone TEXT,
  email TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS wine_types (
  code TEXT PRIMARY KEY,          -- 匯入代碼，例 CP、R
  zh TEXT NOT NULL,
  en TEXT NOT NULL,
  mapped INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS wines (
  id INTEGER PRIMARY KEY,
  wine_no TEXT NOT NULL UNIQUE,
  country TEXT,
  winery TEXT NOT NULL,
  name TEXT NOT NULL,
  region TEXT,
  vintage TEXT,                    -- 4 位數年份或 'NV'
  type_code TEXT REFERENCES wine_types(code),
  volume_ml INTEGER NOT NULL DEFAULT 750,
  suggested_price INTEGER,
  ws_url TEXT,
  grapes TEXT,
  classification TEXT,
  notes TEXT,
  match_key TEXT NOT NULL UNIQUE,
  search_key TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by TEXT,
  updated_at TEXT
);

-- 酒箱 Box / Case
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  case_no TEXT NOT NULL UNIQUE,
  rack_id INTEGER NOT NULL REFERENCES racks(id),
  kind TEXT,
  capacity INTEGER,
  location_uncertain INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 採購批次：同一款酒、同一次採購
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY,
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  merchant_id INTEGER REFERENCES merchants(id),
  purchase_price INTEGER,
  purchase_date TEXT,
  note TEXT
);

-- 單瓶：每瓶唯一瓶號；放在酒箱內（case_id）或直接放在架子上（case_id 為空）
CREATE TABLE IF NOT EXISTS bottles (
  id INTEGER PRIMARY KEY,
  bottle_no TEXT NOT NULL UNIQUE,
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  lot_id INTEGER REFERENCES lots(id),
  case_id INTEGER REFERENCES cases(id),
  rack_id INTEGER NOT NULL REFERENCES racks(id),
  status TEXT NOT NULL DEFAULT 'in_stock',   -- in_stock / reserved / shipped / broken / out（出庫）
  label_printed_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS bottles_wine ON bottles(wine_id);
CREATE INDEX IF NOT EXISTS bottles_case ON bottles(case_id);
CREATE INDEX IF NOT EXISTS bottles_rack ON bottles(rack_id);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY,
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  price INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  source TEXT,
  url TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS price_wine ON price_history(wine_id, effective_date);

-- 異動紀錄：唯讀，只新增不修改
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_login TEXT NOT NULL,
  category TEXT NOT NULL,          -- 酒款 / 庫存 / 銷售 / 價格 / 匯入 / 設定 / 匯出
  action TEXT NOT NULL,
  obj_type TEXT,
  obj_id TEXT,
  obj_label TEXT,
  changes TEXT,                    -- JSON
  batch_id TEXT,
  reason TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is read-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is read-only'); END;

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  filename TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  summary TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- ===== 里程碑 2 =====
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  customer_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '個人',          -- 個人 / 公司
  tax_id TEXT,
  contact TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  lang TEXT NOT NULL DEFAULT 'zh',
  discount REAL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- 清單：品項固定（快照），數量與價格顯示最新值
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  source TEXT,                      -- search / scan / manual
  query TEXT,                       -- 建立時的搜尋條件
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS list_items (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  pos INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  UNIQUE (list_id, wine_id)
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  file TEXT NOT NULL,
  is_main INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ===== 里程碑 3 =====
-- 查價紀錄：控制查價速度（每款間隔、每小時、每天上限）
CREATE TABLE IF NOT EXISTS price_lookups (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_login TEXT NOT NULL,
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  url TEXT,
  result TEXT NOT NULL DEFAULT 'opened'     -- opened / saved / skipped
);
CREATE INDEX IF NOT EXISTS lookups_ts ON price_lookups(ts);

-- 手機離線操作：用操作編號避免重複套用
CREATE TABLE IF NOT EXISTS offline_ops (
  id TEXT PRIMARY KEY,
  user_login TEXT NOT NULL,
  device TEXT,
  op_ts TEXT NOT NULL,                     -- 手機上的操作時間
  received_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,                    -- applied / conflict / resolved / rejected
  result TEXT
);

-- 盤點：掃描結果與差異報告
CREATE TABLE IF NOT EXISTS stocktakes (
  id INTEGER PRIMARY KEY,
  locker_id INTEGER NOT NULL REFERENCES lockers(id),
  user_login TEXT NOT NULL,
  started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  scanned TEXT NOT NULL,
  report TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0
);

-- ===== 第二期：訂單 =====
CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  label TEXT,
  address TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

-- 狀態：draft 草稿 / confirmed 已確認（保留庫存）/ shipped 已出貨 / cancelled 已取消
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  order_date TEXT NOT NULL,
  delivery_date TEXT,
  lang TEXT NOT NULL DEFAULT 'zh',
  address TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 5,
  from_list_id INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  confirmed_by TEXT, confirmed_at TEXT,
  shipped_by TEXT, shipped_at TEXT,
  cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  qty INTEGER NOT NULL,
  unit_price INTEGER,          -- 銷售價格（未稅，每瓶）；依訂單與客戶而不同
  discount REAL NOT NULL DEFAULT 0,  -- %
  pos INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
-- 保留／出貨的瓶號
CREATE TABLE IF NOT EXISTS order_bottles (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  line_id INTEGER NOT NULL REFERENCES order_lines(id),
  bottle_id INTEGER NOT NULL REFERENCES bottles(id),
  state TEXT NOT NULL DEFAULT 'reserved',   -- reserved / shipped
  PRIMARY KEY (order_id, bottle_id)
);
CREATE INDEX IF NOT EXISTS order_bottles_bottle ON order_bottles(bottle_id);
