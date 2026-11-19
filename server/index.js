import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { openDb, ROOT } from './db.js';
import { createApp } from './app.js';
import { ensureTls, lanAddresses } from './tls.js';

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const DATA = process.env.MYWINES_DATA || path.join(ROOT, 'data');
const db = openDb();
let tls = null;
try { tls = ensureTls(path.join(DATA, 'tls')); } catch (e) { console.error('無法建立 HTTPS 憑證：', e.message); }
const app = createApp(db, { caPath: tls?.caPath, httpsPort: HTTPS_PORT, httpPort: PORT });

http.createServer(app).listen(PORT, '0.0.0.0', () => {
  if (tls) https.createServer({ key: tls.key, cert: tls.cert }, app).listen(HTTPS_PORT, '0.0.0.0', print);
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
