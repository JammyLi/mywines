// 由 vite 建置時產生；快取畫面檔案，讓手機在酒窖沒有訊號時也能開啟。資料由 IndexedDB 另外處理。
const CACHE = 'mywines-__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('mywines-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/setup' || url.pathname === '/ca.crt') return; // 資料不快取
  if (e.request.mode === 'navigate') {
    // 畫面：先試網路（3 秒），失敗用快取
    e.respondWith(Promise.race([fetch(e.request), new Promise((_, no) => setTimeout(no, 3000))]).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && url.pathname.startsWith('/assets/')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});
