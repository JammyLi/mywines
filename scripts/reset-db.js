// 清空資料庫（會先備份）
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/db.js';

const dir = path.join(ROOT, 'data');
const file = process.env.MYWINES_DB || path.join(dir, 'mywines.db');
if (fs.existsSync(file)) {
  const bak = path.join(dir, 'backup', `mywines-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  fs.mkdirSync(path.dirname(bak), { recursive: true });
  fs.copyFileSync(file, bak);
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  console.log('已備份到', bak, '並清空資料庫。下次啟動會重新建立 jammy 帳號。');
} else console.log('沒有資料庫檔案，不需清空。');
