// 公司名稱（設定 › 公司資料），左上角與登入畫面共用；儲存後即時更新
import { useEffect, useState } from 'react';

let cache = null;
const subs = new Set();
export async function reloadCompany() {
  try { cache = await (await fetch('/api/public/company', { cache: 'no-store' })).json(); } catch { /* 離線時保留舊值 */ }
  try { if (cache) localStorage.setItem('company', JSON.stringify(cache)); } catch { /* */ }
  subs.forEach((f) => f(cache));
}
export function useCompany() {
  const [c, set] = useState(() => cache || (() => { try { return JSON.parse(localStorage.getItem('company')); } catch { return null; } })());
  useEffect(() => { subs.add(set); if (!cache) reloadCompany(); return () => subs.delete(set); }, []);
  return c;
}
export const companyName = (c, zh) => (c ? (zh ? c.name_zh : c.name_en || c.name_zh) : '');
