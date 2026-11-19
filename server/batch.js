// 設定項目的批次 Excel：下載範本 → 上傳預覽 → 確認寫入；也可匯出現有資料
import multer from 'multer';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { audit } from './db.js';
import { clean } from './importer.js';
import { addPrice } from './m2.js';
import { latestPrice, latestDate } from './search.js';

const yes = (v) => !/^(0|n|no|false|停用|否|inactive)$/i.test(clean(v));
const langOf = (v) => (/^(en|english|英文)$/i.test(clean(v)) ? 'en' : 'zh');

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

export function mountBatch(app, db, { h, bad, tx, checkPw, checkLogin, custRow, CUST, MER, nextNo }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const pending = new Map();

  const KINDS = {
    users: {
      label: '使用者',
      cols: [['login', '登入名稱', 'Login', true], ['name', '姓名', 'Name'], ['password', '密碼（6 位數字，新使用者必填）', 'Password (6 digits)'], ['lang', '介面語言', 'Language'], ['active', '狀態', 'Status']],
      example: { login: 'mary', name: '王小美', password: '246810', lang: '中文', active: '啟用' },
      note: '密碼只用來建立或重設，匯出檔不會包含密碼。登入名稱建立後不能修改。',
      exportRows: () => db.prepare('SELECT login, name, lang, active FROM users ORDER BY login').all().map((u) => ({ ...u, lang: u.lang === 'en' ? 'English' : '中文', active: u.active ? '啟用' : '停用', password: '' })),
      plan: (r) => {
        const login = checkLogin(r.login);
        const old = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
        const pw = clean(r.password);
        if (pw) checkPw(pw);
        const next = { name: clean(r.name) || null, lang: r.lang ? langOf(r.lang) : old?.lang || 'zh', active: r.active ? (yes(r.active) ? 1 : 0) : old ? old.active : 1 };
        if (!old) { if (!pw) bad('新使用者需要密碼'); return { action: 'new', key: login, label: next.name || login, data: { login, ...next, pw } }; }
        const changes = {};
        if ((old.name ?? null) !== next.name && r.name !== '') changes['姓名'] = [old.name, next.name];
        if (old.lang !== next.lang) changes['介面語言'] = [old.lang, next.lang];
        if (old.active !== next.active) changes['狀態'] = [old.active ? '啟用' : '停用', next.active ? '啟用' : '停用'];
        if (pw) changes['密碼'] = '重設';
        return { action: Object.keys(changes).length ? 'update' : 'same', key: login, label: next.name || login, changes, data: { id: old.id, ...next, name: r.name === '' ? old.name : next.name, pw } };
      },
      apply: (p, user) => {
        const d = p.data;
        if (p.action === 'new') db.prepare('INSERT INTO users (login, name, pw_hash, lang, active) VALUES (?, ?, ?, ?, ?)').run(d.login, d.name, bcrypt.hashSync(d.pw, 10), d.lang, d.active);
        else {
          db.prepare('UPDATE users SET name = ?, lang = ?, active = ? WHERE id = ?').run(d.name, d.lang, d.active, d.id);
          if (d.pw) db.prepare('UPDATE users SET pw_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(d.pw, 10), d.id);
          if (d.pw || !d.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(d.id);
        }
        const changes = { ...p.changes };
        audit(db, { user, category: '設定', action: p.action === 'new' ? '新增使用者' : '修改使用者', obj_type: 'user', obj_id: p.key, obj_label: p.label, changes: Object.keys(changes).length ? changes : null });
      },
      guard: (plans) => {
        const activeAfter = db.prepare('SELECT login, active FROM users').all().map((u) => { const p = plans.find((x) => x.key === u.login && x.data); return p ? p.data.active : u.active; }).filter(Boolean).length
          + plans.filter((p) => p.action === 'new' && p.data.active).length;
        if (!activeAfter) bad('至少要保留一位啟用中的使用者');
      },
    },
    customers: {
      label: '客戶',
      cols: [['customer_no', '客戶編號（新客戶留空）', 'Customer no.'], ['name', '名稱', 'Name', true], ['kind', '類型（個人／公司）', 'Kind'], ['tax_id', '統一編號', 'Tax ID'], ['contact', '聯絡人', 'Contact'],
        ['phone', '電話', 'Phone'], ['email', 'Email', 'Email'], ['address', '地址', 'Address'], ['lang', '偏好語言', 'Language'], ['discount', '預設折扣 %', 'Discount %'], ['note', '備註', 'Note']],
      example: { customer_no: '', name: '陳先生', kind: '個人', phone: '0912-000-000', lang: '中文', note: '偏好香檳' },
      exportRows: () => db.prepare('SELECT * FROM customers ORDER BY customer_no').all().map((c) => ({ ...c, lang: c.lang === 'en' ? 'English' : '中文' })),
      plan: (r) => {
        const no = clean(r.customer_no).toUpperCase();
        const old = no ? db.prepare('SELECT * FROM customers WHERE customer_no = ?').get(no) || bad('找不到客戶編號 ' + no) : null;
        const b = Object.fromEntries(Object.entries(r).filter(([k, v]) => CUST.includes(k) && (v !== '' || !old)));
        if ('lang' in b) b.lang = langOf(b.lang);
        const row = custRow(b, old || {});
        if (!old) return { action: 'new', key: '（新）', label: row.name, data: row };
        const changes = {};
        for (const k of CUST) if ((old[k] ?? null) !== (row[k] ?? null)) changes[k] = [old[k], row[k]];
        return { action: Object.keys(changes).length ? 'update' : 'same', key: no, label: row.name, changes, data: { ...row, id: old.id } };
      },
      apply: (p, user) => {
        if (p.action === 'new') {
          const no = nextNo(db, 'customer', 'C-', 4);
          db.prepare(`INSERT INTO customers (customer_no, ${CUST.join(',')}) VALUES (@customer_no, ${CUST.map((k) => '@' + k).join(',')})`).run({ ...p.data, customer_no: no });
          audit(db, { user, category: '設定', action: '新增客戶', obj_type: 'customer', obj_id: no, obj_label: p.label });
        } else {
          db.prepare(`UPDATE customers SET ${CUST.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(p.data);
          audit(db, { user, category: '設定', action: '修改客戶', obj_type: 'customer', obj_id: p.key, obj_label: p.label, changes: p.changes });
        }
      },
    },
    merchants: {
      label: '酒商',
      cols: [['name', '名稱', 'Name', true], ['kind', '類型', 'Kind'], ['contact', '聯絡人', 'Contact'], ['phone', '電話', 'Phone'], ['email', 'Email', 'Email'], ['note', '備註', 'Note']],
      example: { name: '樂潘', kind: '進口商', phone: '02-2000-0000' },
      exportRows: () => db.prepare('SELECT * FROM merchants ORDER BY name').all(),
      plan: (r) => {
        const name = clean(r.name) || bad('請填寫名稱');
        const old = db.prepare('SELECT * FROM merchants WHERE name = ?').get(name);
        const row = Object.fromEntries(MER.map((k) => [k, k === 'name' ? name : clean(r[k]) || (old ? old[k] : null) || null]));
        if (!old) return { action: 'new', key: name, label: name, data: row };
        const changes = {};
        for (const k of MER) if ((old[k] ?? null) !== row[k]) changes[k] = [old[k], row[k]];
        return { action: Object.keys(changes).length ? 'update' : 'same', key: name, label: name, changes, data: { ...row, id: old.id } };
      },
      apply: (p, user) => {
        if (p.action === 'new') db.prepare(`INSERT INTO merchants (${MER.join(',')}) VALUES (${MER.map((k) => '@' + k).join(',')})`).run(p.data);
        else db.prepare(`UPDATE merchants SET ${MER.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(p.data);
        audit(db, { user, category: '設定', action: p.action === 'new' ? '新增酒商' : '修改酒商', obj_type: 'merchant', obj_id: p.key, obj_label: p.label, changes: p.changes || null });
      },
    },
    types: {
      label: '種類',
      cols: [['code', '匯入代碼', 'Code', true], ['zh', '中文', 'Chinese', true], ['en', 'English', 'English', true]],
      example: { code: 'CP', zh: '香檳', en: 'Champagne' },
      exportRows: () => db.prepare('SELECT code, zh, en FROM wine_types ORDER BY mapped DESC, rowid').all(),
      plan: (r) => {
        const code = clean(r.code).toUpperCase();
        if (!/^[A-Z0-9]{1,8}$/.test(code)) bad('匯入代碼需為 1–8 個英文字母或數字');
        const zh = clean(r.zh) || bad('請填寫中文'), en = clean(r.en) || bad('請填寫英文');
        const old = db.prepare('SELECT * FROM wine_types WHERE code = ?').get(code);
        if (!old) return { action: 'new', key: code, label: `${zh} ${en}`, data: { code, zh, en } };
        const changes = {};
        if (old.zh !== zh) changes['中文'] = [old.zh, zh];
        if (old.en !== en) changes['English'] = [old.en, en];
        if (!old.mapped) changes['狀態'] = ['待對應', '已對應'];
        return { action: Object.keys(changes).length ? 'update' : 'same', key: code, label: `${zh} ${en}`, changes, data: { code, zh, en } };
      },
      apply: (p, user) => {
        db.prepare('INSERT INTO wine_types (code, zh, en, mapped) VALUES (@code, @zh, @en, 1) ON CONFLICT(code) DO UPDATE SET zh = excluded.zh, en = excluded.en, mapped = 1').run(p.data);
        audit(db, { user, category: '設定', action: p.action === 'new' ? '新增種類' : '修改種類', obj_type: 'type', obj_id: p.key, obj_label: p.label, changes: p.changes || null });
      },
    },
    prices: {
      label: '市場價格',
      cols: [['wine_no', '酒款編號', 'Wine no.', true], ['name', '品名（參考）', 'Name'], ['vintage', '年份（參考）', 'Vintage'], ['current', '目前市場價格（參考）', 'Current price'],
        ['price', '新市場價格', 'New price', true], ['date', '查價日期（YYYY-MM-DD，空白=今天）', 'Date'], ['source', '來源', 'Source']],
      note: '每次更新都新增一筆價格歷史，不覆蓋舊價格。新市場價格留空的列不會更新；變動超過 ±20% 會在預覽中標示。',
      templateRows: () => db.prepare(`SELECT w.wine_no, w.name, w.vintage, ${latestPrice} current FROM wines w WHERE EXISTS (SELECT 1 FROM bottles b WHERE b.wine_id = w.id AND b.status = 'in_stock') ORDER BY w.winery, w.name`).all(),
      exportRows: () => db.prepare(`SELECT w.wine_no, w.name, w.vintage, ${latestPrice} current, ${latestDate} date FROM wines w ORDER BY w.winery, w.name`).all(),
      skipBlank: (r) => !clean(r.price),
      plan: (r) => {
        const w = db.prepare('SELECT * FROM wines WHERE wine_no = ?').get(clean(r.wine_no).toUpperCase()) || bad('找不到酒款編號 ' + r.wine_no);
        const price = Math.round(Number(clean(r.price).replace(/[,NT$\s]/g, '')));
        if (!(price > 0)) bad('新市場價格不正確');
        const date = clean(r.date) || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        if (!/^\d{4}-\d\d-\d\d$/.test(date)) bad('日期格式需為 YYYY-MM-DD');
        const prev = db.prepare('SELECT price, effective_date FROM price_history WHERE wine_id = ? AND voided = 0 ORDER BY effective_date DESC, id DESC LIMIT 1').get(w.id);
        const label = `${w.name} ${w.vintage}`;
        if (prev && prev.price === price && prev.effective_date === date) return { action: 'same', key: w.wine_no, label };
        const ch = prev?.price ? (price - prev.price) / prev.price : null;
        const changes = { 市場價格: [prev?.price ?? null, price], 日期: date };
        if (ch != null) changes['變動'] = (ch > 0 ? '+' : '') + (ch * 100).toFixed(1) + '%' + (Math.abs(ch) > 0.2 ? '（超過 ±20%，請確認）' : '');
        return { action: 'new', key: w.wine_no, label, changes, data: { wine_id: w.id, price, date, source: clean(r.source) || 'Excel 匯入' } };
      },
      apply: (p, user) => {
        const w = db.prepare('SELECT * FROM wines WHERE id = ?').get(p.data.wine_id);
        addPrice(db, w, p.data, user, { tag: '（Excel）' });
      },
    },
    storage: {
      label: '儲位',
      cols: [['cellar', '酒窖', 'Cellar', true], ['locker', '分儲空間', 'Locker', true], ['rack', '架子（選填）', 'Rack'], ['note', '備註', 'Note']],
      example: { cellar: '永興', locker: 'A31', rack: '上層', note: '' },
      note: '每一列是一個分儲空間或架子；已存在的會略過，不會刪除任何儲位。',
      exportRows: () => {
        const rows = db.prepare(`SELECT ce.name cellar, l.code locker, k.code rack, COALESCE(k.note, l.note) note FROM racks k JOIN lockers l ON l.id = k.locker_id JOIN cellars ce ON ce.id = l.cellar_id`).all();
        return rows.sort((a, b) => a.cellar.localeCompare(b.cellar) || a.locker.localeCompare(b.locker, 'zh-Hant', { numeric: true }) || a.rack.localeCompare(b.rack));
      },
      plan: (r) => {
        const cellar = clean(r.cellar) || bad('請填寫酒窖'), locker = clean(r.locker) || bad('請填寫分儲空間'), rack = clean(r.rack);
        const c = db.prepare('SELECT id FROM cellars WHERE name = ?').get(cellar);
        const l = c && db.prepare('SELECT id FROM lockers WHERE cellar_id = ? AND code = ?').get(c.id, locker);
        const k = l && rack && db.prepare('SELECT id FROM racks WHERE locker_id = ? AND code = ?').get(l.id, rack);
        const label = [cellar, locker, rack].filter(Boolean).join(' › ');
        const exists = rack ? k : l;
        const creates = [!c && '酒窖', !l && '分儲空間', rack && !k && '架子'].filter(Boolean);
        return { action: exists ? 'same' : 'new', key: label, label, changes: creates.length ? { 新增: creates.join('、') } : null, data: { cellar, locker, rack, note: clean(r.note) || null } };
      },
      apply: (p, user) => {
        const d = p.data;
        let c = db.prepare('SELECT id FROM cellars WHERE name = ?').get(d.cellar)?.id;
        if (!c) { c = db.prepare('INSERT INTO cellars (name) VALUES (?)').run(d.cellar).lastInsertRowid; audit(db, { user, category: '設定', action: '新增酒窖', obj_type: 'cellar', obj_id: String(c), obj_label: d.cellar }); }
        let l = db.prepare('SELECT id FROM lockers WHERE cellar_id = ? AND code = ?').get(c, d.locker)?.id;
        if (!l) {
          l = db.prepare('INSERT INTO lockers (cellar_id, code, note) VALUES (?, ?, ?)').run(c, d.locker, d.rack ? null : d.note).lastInsertRowid;
          db.prepare("INSERT INTO racks (locker_id, code, is_default) VALUES (?, '未指定', 1)").run(l);
          audit(db, { user, category: '設定', action: '新增分儲空間', obj_type: 'locker', obj_id: String(l), obj_label: `${d.cellar} › ${d.locker}` });
        }
        if (d.rack && !db.prepare('SELECT 1 FROM racks WHERE locker_id = ? AND code = ?').get(l, d.rack)) {
          const k = db.prepare('INSERT INTO racks (locker_id, code, note) VALUES (?, ?, ?)').run(l, d.rack, d.note).lastInsertRowid;
          audit(db, { user, category: '設定', action: '新增架子', obj_type: 'rack', obj_id: String(k), obj_label: p.label });
        }
      },
    },
  };

  const kindOf = (k) => KINDS[k] || bad('不支援的項目');

  async function sheet(kind, rows, title) {
    const K = kindOf(kind);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(K.label);
    const head = ws.addRow(K.cols.map((c) => c[1] + (c[3] ? ' *' : '')));
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2342' } }; });
    for (const r of rows) ws.addRow(K.cols.map((c) => r[c[0]] ?? ''));
    K.cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, c[1].length * 2 + 4); });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const info = wb.addWorksheet('說明');
    info.addRow([`${K.label}${title}`]).font = { bold: true, size: 14 };
    info.addRow(['第一列是欄位名稱，請不要修改；* 為必填。']);
    info.addRow(['上傳後會先顯示預覽，確認後才會寫入，並記入異動紀錄。']);
    if (K.note) info.addRow([K.note]);
    info.getColumn(1).width = 80;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const send = (res, buf, name) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="batch.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.end(buf);
  };

  app.get('/api/batch/:kind/template', h(async (req, res) => {
    const K = kindOf(req.params.kind);
    send(res, await sheet(req.params.kind, K.templateRows ? K.templateRows() : [K.example], '範本'), `${K.label}範本.xlsx`);
  }));
  app.get('/api/batch/:kind/export', h(async (req, res) => {
    const K = kindOf(req.params.kind);
    const rows = K.exportRows();
    audit(db, { user: req.user.login, category: '匯出', action: '匯出' + K.label, obj_type: 'settings', obj_id: req.params.kind, obj_label: K.label, changes: { 筆數: rows.length } });
    send(res, await sheet(req.params.kind, rows, '匯出'), `${K.label}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }));

  app.post('/api/batch/:kind/preview', upload.single('file'), h(async (req) => {
    const kind = req.params.kind;
    const K = kindOf(kind);
    if (!req.file) bad('請選擇 Excel 檔');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(req.file.buffer); } catch { bad('無法讀取檔案，請確認是 .xlsx'); }
    const ws = wb.worksheets[0];
    const map = {};
    ws.getRow(1).eachCell((cell, col) => {
      const t = clean(cellText(cell.value)).replace(/\s*\*$/, '');
      const c = K.cols.find((c) => [c[1], c[2], c[0]].some((x) => x.toLowerCase() === t.toLowerCase() || x.replace(/（.*）/, '').toLowerCase() === t.replace(/（.*）/, '').toLowerCase()));
      if (c) map[col] = c[0];
    });
    const missing = K.cols.filter((c) => c[3] && !Object.values(map).includes(c[0])).map((c) => c[1]);
    if (missing.length) bad('找不到欄位：' + missing.join('、'));
    const plans = [];
    const seen = new Set();
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const r = {};
      for (const [col, key] of Object.entries(map)) r[key] = clean(cellText(row.getCell(Number(col)).value));
      if (!Object.values(r).some(Boolean)) return;
      if (K.skipBlank && K.skipBlank(r)) return;
      try {
        const p = K.plan(r);
        if (p.action !== 'new' || kind !== 'customers') { if (seen.has(p.key)) bad('與前面的列重複'); seen.add(p.key); }
        plans.push({ line: n, ...p });
      } catch (e) { plans.push({ line: n, action: 'error', key: r[K.cols[0][0]] || r[K.cols[1]?.[0]] || '', error: e.message }); }
    });
    const token = crypto.randomBytes(12).toString('hex');
    pending.set(token, { kind, plans, at: Date.now(), user: req.user.login });
    for (const [k, v] of pending) if (Date.now() - v.at > 3600e3) pending.delete(k);
    const count = (a) => plans.filter((p) => p.action === a).length;
    return { token, kind, label: K.label, rows: plans.map(({ data, ...p }) => p), counts: { new: count('new'), update: count('update'), same: count('same'), error: count('error') } };
  }));

  app.post('/api/batch/:kind/commit', h((req) => {
    const pend = pending.get(req.body?.token);
    if (!pend || pend.kind !== req.params.kind) bad('預覽已過期，請重新上傳');
    return tx(() => {
      const K = kindOf(pend.kind);
      const todo = pend.plans.filter((p) => p.action === 'new' || p.action === 'update');
      if (K.guard) K.guard(todo);
      for (const p of todo) K.apply(p, req.user.login);
      audit(db, { user: req.user.login, category: '設定', action: `批次上傳${K.label}`, obj_type: 'batch', obj_id: pend.kind, obj_label: K.label,
        changes: { 新增: todo.filter((p) => p.action === 'new').length, 修改: todo.filter((p) => p.action === 'update').length, 略過: pend.plans.length - todo.length } });
      pending.delete(req.body.token);
      return { applied: todo.length };
    });
  }));
}
