// 系統版本：取自 package.json（每次發佈都要更新版本號，並寫進 CHANGELOG.md）
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.js';

export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
export const STARTED = new Date().toISOString();
