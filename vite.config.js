import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// 建置後產生 sw.js：列出要快取的檔案，讓手機離線也能開啟
function serviceWorker() {
  return {
    name: 'mywines-sw',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve('dist');
      const files = [];
      const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push('/' + path.relative(dist, p).split(path.sep).join('/')); } };
      walk(dist);
      const assets = files.filter((f) => f !== '/sw.js' && f !== '/index.html');
      const version = Date.now().toString(36);
      const tpl = fs.readFileSync(path.resolve('src/sw-template.js'), 'utf8');
      fs.writeFileSync(path.join(dist, 'sw.js'), tpl.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(['/', ...assets])));
    },
  };
}

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

export default defineConfig({
  plugins: [react(), serviceWorker()],
  // 版本號：畫面與伺服器各自帶一份，不一致代表畫面還沒重新建置
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { sourcemap: process.env.SOURCEMAP === '1' },
  server: { host: true, proxy: { '/api': 'http://localhost:3000' } },
});
