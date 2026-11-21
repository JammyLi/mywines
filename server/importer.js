// Excel 酒款清單匯入：解析 → 預覽（問題清單）→ 確認寫入
import ExcelJS from 'exceljs';
import { audit, nextNo } from './db.js';

const HEADER_ALIASES = {
  cellar: ['酒窖', 'cellar', '倉庫'],
  locker: ['位置', '分儲空間', 'locker'],
  rack: ['架子', 'rack'],
  caseNo: ['編號', '箱號', 'box', 'case'],
  country: ['國家', 'country'],
  winery: ['酒莊', 'winery'],
  name: ['品名', 'wine name', 'name'],
  region: ['產區', 'region'],
  vintage: ['年份', 'vintage'],
  type: ['種類', 'type'],
  qty: ['瓶數', 'quantity', 'qty'],
  volume: ['容量', 'volume'],
  merchant: ['酒商', 'merchant', 'supplier'],
  cost: ['採購價格', 'purchase price'],
  market: ['國際均價', '市場價格', 'market price', 'market value'],
  marketDate: ['查價日期', '市場價格生效日期', 'price date'],
  suggested: ['建議售價', '銷售價格', 'selling price'],
};

// 產區同義字（統一為原文正式拼寫）
const REGION_SYNONYMS = { bourgogne: 'Burgundy' };

export const clean = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
export const norm = (s) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

function matchHeader(h) {
  const t = clean(h).toLowerCase();
  for (const [key, list] of Object.entries(HEADER_ALIASES)) {
    if (list.some((a) => t === a.toLowerCase() || t.startsWith(a.toLowerCase()))) return key;
  }
  if (t.startsWith('備註') || t.startsWith('note')) return 'note';
  return null;
}

function toInt(v) {
  const s = clean(v).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseVintage(raw) {
  const s = clean(raw);
  if (!s) return { vintage: 'NV', extra: '' };
  if (/^nv$/i.test(s)) return { vintage: 'NV', extra: '' };
  if (/^\d{4}(\.0+)?$/.test(s)) return { vintage: s.slice(0, 4), extra: '' };
  const m = s.match(/(19|20)\d{2}/);
  if (m) return { vintage: m[0], extra: s, needsReview: true };
  return { vintage: 'NV', extra: s, needsReview: true };
}

function parseDate(raw) {
  const s = clean(raw);
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

function parseVolume(raw) {
  const s = clean(raw).toLowerCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 750;
  if (s.includes('l') && !s.includes('ml')) return Math.round(n * 1000);
  return Math.round(n);
}

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// 找出拼字相近、可能是同一個的名稱
function similarPairs(counts) {
  const names = [...counts.keys()];
  const pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    const ka = norm(a), kb = norm(b);
    if (!ka || !kb) continue;
    const short = Math.min(ka.length, kb.length);
    const contains = short >= 2 && (ka.startsWith(kb) || kb.startsWith(ka));
    const dist = lev(ka, kb);
    const near = (short >= 2 && short < 6 && dist <= 1 && ka.length === kb.length && ka[0] === kb[0]) || (short >= 6 && dist <= 2);
    if (contains || near) {
      // 預設合併到出現次數較多的名稱
      const [to, from] = counts.get(a) >= counts.get(b) ? [a, b] : [b, a];
      pairs.push({ from, to, fromCount: counts.get(from), toCount: counts.get(to) });
    }
  }
  return pairs;
}

const CONFIRMED = { merchant: { '安迪酒藏': '安迪', '吉興': '吉星' } };

export async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const headerRow = ws.getRow(1);
  const cols = {};
  const noteCols = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const key = matchHeader(cellText(cell.value));
    if (key === 'note') noteCols.push(col);
    else if (key && !cols[key]) cols[key] = col;
  });
  const missing = ['winery', 'name', 'qty'].filter((k) => !cols[k]);
  if (missing.length) throw new Error('找不到必要欄位：' + missing.join('、'));

  const rows = [];
  const issues = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r === 1) return;
    const g = (k) => (cols[k] ? cellText(row.getCell(cols[k]).value) : '');
    if (!clean(g('winery')) && !clean(g('name'))) return;
    const cellarLines = String(g('cellar') || '').split(/\r?\n/).map(clean).filter(Boolean);
    let locker = clean(g('locker'));
    const uncertain = locker.includes('?') || locker.includes('？');
    locker = locker.replace(/[?？]/g, '').trim();
    const v = parseVintage(g('vintage'));
    const notes = noteCols.map((c) => clean(cellText(row.getCell(c).value))).filter(Boolean);
    if (v.extra) notes.push('年份原文：' + v.extra);
    const marketRaw = g('market');
    rows.push({
      line: r,
      cellar: cellarLines[0] || '未指定酒窖',
      cellarExtra: cellarLines.slice(1).join(' '),
      locker: locker || '未指定',
      rack: clean(g('rack')),
      caseNo: clean(g('caseNo')),
      country: clean(g('country')),
      winery: clean(g('winery')),
      name: clean(g('name')),
      region: clean(g('region')),
      vintage: v.vintage,
      vintageReview: !!v.needsReview,
      type: clean(g('type')).toUpperCase(),
      qty: toInt(g('qty')) || 0,
      volume: parseVolume(g('volume')),
      merchant: clean(g('merchant')),
      cost: toInt(g('cost')),
      market: toInt(marketRaw),
      marketDate: parseDate(g('marketDate')),
      suggested: toInt(g('suggested')),
      uncertain,
      note: notes.join(' / '),
    });
  });

  // 問題清單
  const count = (field) => { const m = new Map(); for (const x of rows) if (x[field]) m.set(x[field], (m.get(x[field]) || 0) + 1); return m; };
  const merges = { winery: {}, merchant: {}, region: {} };
  const suggestions = [];
  for (const field of ['winery', 'merchant', 'region']) {
    const c = count(field);
    // 只差大小寫、重音、空白 → 自動統一（資訊）
    const byKey = new Map();
    for (const [name, n] of c) { const k = norm(name); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push([name, n]); }
    for (const group of byKey.values()) if (group.length > 1) {
      group.sort((a, b) => b[1] - a[1]);
      const to = group.find(([nm]) => /[^\x00-\x7f]/.test(nm))?.[0] || group[0][0];
      for (const [nm, n] of group) if (nm !== to) { merges[field][nm] = to; suggestions.push({ field, kind: 'spelling', from: nm, to, fromCount: n, auto: true }); }
    }
    if (field === 'region') {
      for (const [nm, n] of c) { const syn = REGION_SYNONYMS[norm(nm)]; if (syn && syn !== nm) { merges.region[nm] = syn; suggestions.push({ field, kind: 'synonym', from: nm, to: syn, fromCount: n, auto: true }); } }
    }
    // 使用者已確認的合併（規格 12.5）
    for (const [from, to] of Object.entries(CONFIRMED[field] || {})) if (c.has(from) && !merges[field][from]) {
      merges[field][from] = to; suggestions.push({ field, kind: 'confirmed', from, to, fromCount: c.get(from), toCount: c.get(to) || 0, auto: true });
    }
    const reduced = new Map();
    for (const [nm, n] of c) { const t = merges[field][nm] || nm; reduced.set(t, (reduced.get(t) || 0) + n); }
    // 拼字相近：只提示，預設不合併，由使用者勾選
    for (const p of similarPairs(reduced)) suggestions.push({ field, kind: 'similar', ...p, auto: false });
  }
  const knownTypes = new Set(['CP', 'R', 'W', 'ROSE', 'SP', 'DES', 'FOR', 'ORA']);
  const unknownTypes = [...count('type')].filter(([t]) => !knownTypes.has(t));
  for (const [t, n] of unknownTypes) issues.push({ kind: 'type', code: t, rows: n, message: `種類代碼「${t}」沒有對應`, fix: '匯入為「待對應」，正式匯入檔會改用明確代碼' });
  const unc = rows.filter((x) => x.uncertain);
  if (unc.length) issues.push({ kind: 'location', rows: unc.length, message: '位置含問號：' + [...new Set(unc.map((x) => x.locker + '?'))].join('、'), fix: '匯入並標記「位置待確認」' });
  const vr = rows.filter((x) => x.vintageReview);
  if (vr.length) issues.push({ kind: 'vintage', rows: vr.length, message: '年份含文字：' + vr.map((x) => x.note.split('年份原文：')[1]).join('、'), fix: '年份取數字，原文移到備註' });
  const extras = [...new Set(rows.map((x) => x.cellarExtra).filter(Boolean))];
  if (extras.length) issues.push({ kind: 'cellar', rows: rows.filter((x) => x.cellarExtra).length, message: '酒窖欄換行後的文字：' + extras.join('、'), fix: '暫不使用（忽略）' });
  const noMarket = rows.filter((x) => x.market == null);
  if (noMarket.length) issues.push({ kind: 'price', rows: noMarket.length, message: '市場價格空白：' + noMarket.map((x) => x.caseNo || '第 ' + x.line + ' 列').join('、'), fix: '匯入，不建立價格紀錄' });
  const noCost = rows.filter((x) => x.cost == null).length;
  if (noCost) issues.push({ kind: 'cost', rows: noCost, message: `採購價格空白 ${noCost} 列`, fix: '允許空白' });
  const caseCount = count('caseNo');
  const dup = [...caseCount].filter(([, n]) => n > 1);
  if (dup.length) issues.push({ kind: 'duplicate', rows: dup.length, message: '箱號重複：' + dup.map(([c]) => c).join('、'), fix: '重複的列不匯入', blocking: true });
  const noCase = rows.filter((x) => !x.caseNo).length;
  if (noCase) issues.push({ kind: 'nocase', rows: noCase, message: `${noCase} 列沒有箱號`, fix: '以散瓶放在架子上' });

  return { rows, suggestions, merges, issues };
}

export function searchKey(x) {
  return [x.wine_no, x.winery, x.name, x.region, x.country, x.vintage].map(norm).join(' ');
}

export function wineKey(x) {
  return [norm(x.winery), norm(x.name), x.vintage, x.volume].join('|');
}

export function summarize(db, parsed, merges = parsed.merges) {
  const keys = new Set(), newKeys = new Set(), priceKeys = new Set();
  const exists = db.prepare('SELECT 1 FROM wines WHERE match_key = ?');
  for (const x0 of parsed.rows) {
    const x = applyMerges(x0, merges);
    const k = wineKey(x);
    keys.add(k);
    if (!exists.get(k)) newKeys.add(k);
    if (x.market != null && x.marketDate) priceKeys.add(k + '|' + x.marketDate + '|' + x.market);
  }
  return {
    rows: parsed.rows.length,
    wines: keys.size,
    newWines: newKeys.size,
    cases: parsed.rows.filter((x) => x.caseNo).length,
    bottles: parsed.rows.reduce((s, x) => s + x.qty, 0),
    prices: priceKeys.size,
  };
}

function applyMerges(x, merges) {
  return {
    ...x,
    winery: merges.winery?.[x.winery] || x.winery,
    merchant: merges.merchant?.[x.merchant] || x.merchant,
    region: merges.region?.[x.region] || x.region,
  };
}

export function commitImport(db, parsed, { merges = parsed.merges, user, filename }) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const n = db.prepare("SELECT COUNT(*) c FROM import_batches WHERE id LIKE ?").get(`IMP-${today}-%`).c + 1;
  const batchId = `IMP-${today}-${String(n).padStart(2, '0')}`;
  const q = {
    cellar: db.prepare('SELECT id FROM cellars WHERE name = ?'),
    cellarIns: db.prepare('INSERT INTO cellars (name) VALUES (?)'),
    locker: db.prepare('SELECT id FROM lockers WHERE cellar_id = ? AND code = ?'),
    lockerIns: db.prepare('INSERT INTO lockers (cellar_id, code) VALUES (?, ?)'),
    rack: db.prepare('SELECT id FROM racks WHERE locker_id = ? AND code = ?'),
    rackIns: db.prepare('INSERT INTO racks (locker_id, code, is_default) VALUES (?, ?, ?)'),
    merchant: db.prepare('SELECT id FROM merchants WHERE name = ?'),
    merchantIns: db.prepare('INSERT INTO merchants (name) VALUES (?)'),
    type: db.prepare('SELECT code FROM wine_types WHERE code = ?'),
    typeIns: db.prepare("INSERT INTO wine_types (code, zh, en, mapped) VALUES (?, ?, ?, 0)"),
    wine: db.prepare('SELECT id FROM wines WHERE match_key = ?'),
    wineIns: db.prepare(`INSERT INTO wines (wine_no, country, winery, name, region, vintage, type_code, volume_ml, suggested_price, match_key, search_key, created_by)
      VALUES (@wine_no, @country, @winery, @name, @region, @vintage, @type_code, @volume_ml, @suggested_price, @match_key, @search_key, @user)`),
    caseExists: db.prepare('SELECT 1 FROM cases WHERE case_no = ?'),
    caseIns: db.prepare('INSERT INTO cases (case_no, rack_id, capacity, location_uncertain, note) VALUES (?, ?, ?, ?, ?)'),
    lotIns: db.prepare('INSERT INTO lots (wine_id, merchant_id, purchase_price, note) VALUES (?, ?, ?, ?)'),
    bottleIns: db.prepare('INSERT INTO bottles (bottle_no, wine_id, lot_id, case_id, rack_id) VALUES (?, ?, ?, ?, ?)'),
    priceExists: db.prepare('SELECT 1 FROM price_history WHERE wine_id = ? AND effective_date = ? AND price = ?'),
    priceIns: db.prepare("INSERT INTO price_history (wine_id, price, effective_date, source, created_by) VALUES (?, ?, ?, ?, ?)"),
  };
  const getOrCreate = (sel, ins, ...args) => sel.get(...args)?.id ?? ins.run(...args).lastInsertRowid;
  const stats = { wines: 0, cases: 0, bottles: 0, prices: 0, skipped: [] };

  const run = db.transaction(() => {
    db.prepare('INSERT INTO import_batches (id, filename, created_by) VALUES (?, ?, ?)').run(batchId, filename, user);
    for (const x0 of parsed.rows) {
      const x = applyMerges(x0, merges);
      if (x.caseNo && q.caseExists.get(x.caseNo)) { stats.skipped.push({ line: x.line, reason: '箱號已存在 ' + x.caseNo }); continue; }
      const cellarId = getOrCreate(q.cellar, q.cellarIns, x.cellar);
      const lockerId = q.locker.get(cellarId, x.locker)?.id ?? q.lockerIns.run(cellarId, x.locker).lastInsertRowid;
      const rackCode = x.rack || '未指定';
      const rackId = q.rack.get(lockerId, rackCode)?.id ?? q.rackIns.run(lockerId, rackCode, x.rack ? 0 : 1).lastInsertRowid;
      const merchantId = x.merchant ? getOrCreate(q.merchant, q.merchantIns, x.merchant) : null;
      let typeCode = x.type || null;
      if (typeCode && !q.type.get(typeCode)) q.typeIns.run(typeCode, '待對應（' + typeCode + '）', 'Unmapped (' + typeCode + ')');
      const key = wineKey(x);
      let wineId = q.wine.get(key)?.id;
      if (!wineId) {
        const wineNo = nextNo(db, 'wine', 'W-', 6);
        wineId = q.wineIns.run({ wine_no: wineNo, country: x.country, winery: x.winery, name: x.name, region: x.region, vintage: x.vintage,
          type_code: typeCode, volume_ml: x.volume, suggested_price: x.suggested, match_key: key,
          search_key: searchKey({ ...x, wine_no: wineNo }), user }).lastInsertRowid;
        stats.wines++;
        audit(db, { user, category: '匯入', action: '新增酒款', obj_type: 'wine', obj_id: wineNo, obj_label: `${x.name} ${x.vintage}`, batch_id: batchId });
      }
      let caseId = null;
      if (x.caseNo) {
        caseId = q.caseIns.run(x.caseNo, rackId, x.qty || null, x.uncertain ? 1 : 0, x.note || null).lastInsertRowid;
        stats.cases++;
      }
      const lotId = q.lotIns.run(wineId, merchantId, x.cost, x.caseNo ? null : x.note || null).lastInsertRowid;
      const first = stats.bottles;
      for (let i = 0; i < x.qty; i++) { q.bottleIns.run(nextNo(db, 'bottle', 'B-', 7), wineId, lotId, caseId, rackId); stats.bottles++; }
      if (x.caseNo) audit(db, { user, category: '匯入', action: '建立酒箱', obj_type: 'case', obj_id: x.caseNo, obj_label: `${x.cellar} › ${x.locker} › ${rackCode}`,
        changes: { 瓶數: x.qty, 位置待確認: x.uncertain || undefined, 瓶號數: stats.bottles - first }, batch_id: batchId });
      if (x.market != null && x.marketDate && !q.priceExists.get(wineId, x.marketDate, x.market)) {
        q.priceIns.run(wineId, x.market, x.marketDate, 'Excel 匯入（國際均價）', user); stats.prices++;
      }
    }
    const summary = { ...stats, skipped: stats.skipped.length };
    db.prepare('UPDATE import_batches SET summary = ? WHERE id = ?').run(JSON.stringify(summary), batchId);
    audit(db, { user, category: '匯入', action: '匯入酒款清單', obj_type: 'import', obj_id: batchId, obj_label: filename,
      changes: { 酒款: stats.wines, 酒箱: stats.cases, 瓶: stats.bottles, 價格: stats.prices, 略過: stats.skipped.length }, batch_id: batchId });
  });
  run();
  return { batchId, ...stats };
}

// 匯入範本：欄位名稱與 HEADER_ALIASES 第一個名稱一致，附範例與說明
const TEMPLATE_COLS = [
  ['酒窖', '酒窖名稱。空白＝「未指定」', 10, '永興'],
  ['位置', '分儲空間代碼，例如 A31。代碼後加「?」代表位置待確認', 10, 'A31'],
  ['架子', '架子名稱。空白＝放在該分儲空間的「未指定」架子', 10, '上層'],
  ['編號', '箱號。整箱入庫時填；散瓶留空', 12, 'C-0001'],
  ['國家', '', 10, 'France'],
  ['酒莊', '必填', 22, 'Domaine Leroy'],
  ['品名', '必填', 36, 'Bourgogne Aligoté'],
  ['產區', '例如 Burgundy、Champagne', 14, 'Burgundy'],
  ['年份', '四位數年份，無年份填 NV', 8, 2018],
  ['種類', '種類代碼，見「種類代碼」工作表', 8, 'W'],
  ['瓶數', '必填，整數', 8, 6],
  ['容量', 'ml，空白＝750；也可寫 1.5L', 8, 750],
  ['酒商', '向哪家酒商採購', 16, '示範酒商'],
  ['採購價格', '每瓶 NT$', 12, 3200],
  ['國際均價', '每瓶市場價格 NT$', 12, 4500],
  ['查價日期', '市場價格的日期 YYYY-MM-DD', 12, '2026-11-01'],
  ['建議售價', '每瓶 NT$', 12, 5800],
  ['備註', '任何補充說明', 20, ''],
];

export async function importTemplate(types) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('庫存');
  const head = ws.addRow(TEMPLATE_COLS.map((c) => c[0]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c, i) => {
    const req = /必填/.test(TEMPLATE_COLS[i - 1][1]);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: req ? 'FF7B2342' : 'FF8A7F84' } };
    c.note = TEMPLATE_COLS[i - 1][1] || undefined;
  });
  ws.addRow(TEMPLATE_COLS.map((c) => c[3]));
  ws.addRow(['永興', 'A32', '', 'C-0002', 'France', 'Krug', 'Grande Cuvée 171ème Édition', 'Champagne', 'NV', 'CP', 6, 750, '示範酒商', 6800, 8200, '2026-11-01', 9800, '']);
  ws.addRow(['永興', 'B12?', '', '', 'Italy', 'Gaja', 'Barbaresco', 'Piedmont', 2019, 'R', 2, '1.5L', '', '', '', '', '', '散瓶，位置待確認']);
  TEMPLATE_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c[2] + 2; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const info = wb.addWorksheet('說明');
  info.addRow(['庫存匯入範本']).font = { bold: true, size: 14 };
  for (const line of [
    '1. 在「庫存」工作表填資料：第一列是欄位名稱，請不要修改；深紅色欄位為必填（酒莊、品名、瓶數）。',
    '2. 範例的 3 列請刪除或改成你的資料。一列＝同一款酒、同一個位置的一批瓶數。',
    '3. 到系統「匯入」把檔案拖進去，先預覽問題、確認後才會寫入。',
    '4. 同一款酒（酒莊＋品名＋年份＋容量相同）會合併成一個酒款，不會重複建立。',
    '5. 不需要的欄位可以整欄刪除；欄位順序可以調整。',
    '',
  ]) info.addRow([line]);
  const h2 = info.addRow(['欄位', '說明', '範例']); h2.font = { bold: true };
  for (const c of TEMPLATE_COLS) info.addRow([c[0], c[1], c[3]]);
  info.getColumn(1).width = 12; info.getColumn(2).width = 60; info.getColumn(3).width = 30;

  const tw = wb.addWorksheet('種類代碼');
  tw.addRow(['代碼', '中文', 'English']).font = { bold: true };
  for (const t of types) tw.addRow([t.code, t.zh, t.en]);
  tw.getColumn(1).width = 10; tw.getColumn(2).width = 16; tw.getColumn(3).width = 20;
  return wb.xlsx.writeBuffer();
}
