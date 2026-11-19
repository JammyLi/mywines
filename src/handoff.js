// 在頁面之間傳較大的資料（例如上百個瓶號）
export function handoff(data) {
  const k = Date.now().toString(36);
  try { sessionStorage.setItem('ho:' + k, JSON.stringify(data)); } catch {}
  return k;
}
export function receive(k) {
  if (!k) return null;
  try { return JSON.parse(sessionStorage.getItem('ho:' + k)); } catch { return null; }
}
