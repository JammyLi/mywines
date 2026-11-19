import { norm } from './importer.js';

export const STALE_DAYS = 30;

export const latestPrice = `(SELECT price FROM price_history p WHERE p.wine_id = w.id AND p.voided = 0 ORDER BY effective_date DESC, id DESC LIMIT 1)`;
export const latestDate = `(SELECT effective_date FROM price_history p WHERE p.wine_id = w.id AND p.voided = 0 ORDER BY effective_date DESC, id DESC LIMIT 1)`;

export const SQL = { latestPrice, latestDate, STALE_DAYS };

// 搜尋條件 → FROM … WHERE（搜尋、清單、匯出、標籤共用）
export function buildSearch(q) {
  const where = ["b.status = 'in_stock'"];
  const p = {};
  if (q.q) {
    p.q = '%' + norm(q.q) + '%';
    p.raw = '%' + String(q.q).trim() + '%';
    where.push(`(w.search_key LIKE @q OR c.case_no LIKE @raw OR b.bottle_no LIKE @raw OR l.code LIKE @raw)`);
  }
  const list = (v) => (Array.isArray(v) ? v : String(v).split(',')).filter(Boolean);
  if (q.type) { const t = list(q.type); where.push(`w.type_code IN (${t.map((_, i) => '@t' + i).join(',')})`); t.forEach((v, i) => (p['t' + i] = v)); }
  if (q.region) { p.region = q.region; where.push('w.region = @region'); }
  if (q.cellar) { p.cellar = Number(q.cellar); where.push('ce.id = @cellar'); }
  if (q.locker) { p.locker = Number(q.locker); where.push('l.id = @locker'); }
  if (q.rack) { p.rack = Number(q.rack); where.push('k.id = @rack'); }
  if (q.merchant) { p.merchant = Number(q.merchant); where.push('lot.merchant_id = @merchant'); }
  if (q.vmin || q.vmax) {
    const nv = q.nv === '1' ? " OR w.vintage = 'NV'" : '';
    const c = [];
    if (q.vmin) { p.vmin = String(q.vmin); c.push("w.vintage >= @vmin"); }
    if (q.vmax) { p.vmax = String(q.vmax); c.push("w.vintage <= @vmax"); }
    where.push(`((w.vintage <> 'NV' AND ${c.join(' AND ')})${nv})`);
  } else if (q.nv === '0') where.push("w.vintage <> 'NV'");
  if (q.pmin) { p.pmin = Number(q.pmin); where.push(`${latestPrice} >= @pmin`); }
  if (q.pmax) { p.pmax = Number(q.pmax); where.push(`${latestPrice} <= @pmax`); }
  if (q.stale === '1') where.push(`(${latestDate} IS NULL OR ${latestDate} < date('now','localtime','-${STALE_DAYS} days'))`);
  if (q.uncertain === '1') where.push('c.location_uncertain = 1');
  if (q.nocost === '1') where.push('lot.purchase_price IS NULL');
  if (q.wine_ids) { const ids = list(q.wine_ids).map(Number); where.push(`w.id IN (${ids.map((_, i) => '@w' + i).join(',') || 'NULL'})`); ids.forEach((v, i) => (p['w' + i] = v)); }
  if (q.case_no) { p.case_no = q.case_no; where.push('c.case_no = @case_no'); }
  const from = `FROM bottles b JOIN wines w ON w.id = b.wine_id JOIN racks k ON k.id = b.rack_id JOIN lockers l ON l.id = k.locker_id
    JOIN cellars ce ON ce.id = l.cellar_id LEFT JOIN cases c ON c.id = b.case_id LEFT JOIN lots lot ON lot.id = b.lot_id
    LEFT JOIN merchants m ON m.id = lot.merchant_id LEFT JOIN wine_types t ON t.code = w.type_code WHERE ${where.join(' AND ')}`;
  return { from, p };
}

