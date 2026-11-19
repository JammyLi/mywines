// 用法：npm run import -- 路徑/Inventory.xlsx
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { parseWorkbook, summarize, commitImport } from '../server/importer.js';

const file = process.argv[2];
if (!file) { console.error('用法：npm run import -- 檔案.xlsx'); process.exit(1); }
const db = openDb();
const parsed = await parseWorkbook(fs.readFileSync(file));
console.log('預覽：', summarize(db, parsed));
for (const i of parsed.issues) console.log(' ・', i.message, '→', i.fix);
const r = commitImport(db, parsed, { user: process.env.MYWINES_USER || 'jammy', filename: path.basename(file) });
console.log('完成：', r);
