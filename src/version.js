// 畫面版本（建置時寫入）與伺服器版本比對
import { useEffect, useState } from 'react';

/* global __APP_VERSION__, __BUILD_TIME__ */
export const CLIENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;

let cache = null;
// 一載入就先問伺服器（版本與連接埠），之後的元件直接用
const first = fetch('/api/public/version').then((r) => r.json()).then((x) => { cache = x; return x; }).catch(() => null);
export function useServerVersion() {
  const [v, setV] = useState(cache);
  useEffect(() => {
    first.then((x) => x && setV(x));
  }, []);
  return v;
}

// 清掉快取的舊畫面後重新載入
export async function hardReload() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
    await Promise.all(regs.map((r) => r.update().catch(() => {})));
    const keys = (await caches?.keys()) || [];
    await Promise.all(keys.filter((k) => k.startsWith('mywines-')).map((k) => caches.delete(k)));
  } catch { /* 忽略 */ }
  location.reload();
}

export const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso), p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 手機設定頁網址：一律走 http 連接埠（https 頁面上也要換成 http 的連接埠）
export function setupUrl() {
  const http = cache?.httpPort || (location.protocol === 'http:' ? location.port : '') || 3000;
  return `http://${location.hostname}:${http}/setup`;
}
