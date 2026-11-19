// 畫面版本（建置時寫入）與伺服器版本比對
import { useEffect, useState } from 'react';

/* global __APP_VERSION__, __BUILD_TIME__ */
export const CLIENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;

let cache = null;
export function useServerVersion() {
  const [v, setV] = useState(cache);
  useEffect(() => {
    fetch('/api/public/version').then((r) => r.json()).then((x) => { cache = x; setV(x); }).catch(() => {});
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
