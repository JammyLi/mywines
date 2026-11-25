import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, ROOT } from './db.js';
import { createApp } from './app.js';
import { ensureTls, lanAddresses } from './tls.js';

const DATA = process.env.MYWINES_DATA || path.join(ROOT, 'data');
// 連接埠：環境變數 > data/config.json > 預設 3000／3443
// 例：data/config.json 內容 {"port": 3200, "httpsPort": 3643}
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('data/config.json 格式錯誤，使用預設連接埠：', e.message); }
const PORT = Number(process.env.PORT) || Number(cfg.port) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || Number(cfg.httpsPort) || 3443;
const db = openDb();
let tls = null;
try { tls = ensureTls(path.join(DATA, 'tls')); } catch (e) { console.error('無法建立 HTTPS 憑證：', e.message); }
const app = createApp(db, { caPath: tls?.caPath, httpsPort: HTTPS_PORT, httpPort: PORT });

// 連接埠被別的程式用掉時，說明怎麼處理（不要只丟出錯誤）
const busy = (port) => (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`\n連接埠 ${port} 已被其他程式使用（可能是舊的系統還在執行，或其他應用程式）。`);
  console.error('  ‧ 舊的系統還開著：到那個終端機視窗按 Ctrl+C，再重新啟動。');
  console.error(`  ‧ 要換連接埠：在 ${path.join(DATA, 'config.json')} 寫入 {"port": 3200, "httpsPort": 3643}\n`);
  process.exit(1);
};
http.createServer(app).on('error', busy(PORT)).listen(PORT, '0.0.0.0', () => {
  if (tls) https.createServer({ key: tls.key, cert: tls.cert }, app).on('error', busy(HTTPS_PORT)).listen(HTTPS_PORT, '0.0.0.0', print);
  else print();
});

function print() {
  const ips = lanAddresses();
  console.log('\n酒類庫存管理系統已啟動');
  console.log(`  這台電腦：http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  其他電腦（同一 Wi-Fi）：http://${ip}:${PORT}`);
  if (tls) {
    for (const ip of ips) console.log(`  手機（可掃描、離線）：https://${ip}:${HTTPS_PORT}`);
    for (const ip of ips) console.log(`  手機第一次使用，先開：http://${ip}:${PORT}/setup`);
    if (tls.fresh) console.log('  （已為目前的內網 IP 產生新的 HTTPS 憑證）');
  }
  console.log('\n按 Ctrl+C 停止\n');
}
