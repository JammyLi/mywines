import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

process.env.MYWINES_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-'));
const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

async function setup() {
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  const U = `http://localhost:${server.address().port}`;
  const r = await fetch(U + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'jammy', password: '123456' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (method, url, body) => {
    const init = { method, headers: { cookie } };
    if (body instanceof FormData) init.body = body;
    else if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(U + url, init);
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync('sample_data/Inventory.xlsx')]), 'Inventory.xlsx');
  const p = (await call('POST', '/api/import/preview', fd)).body;
  await call('POST', '/api/import/commit', { token: p.token });
  return { db, server, call };
}
const logs = (db, action) => db.prepare('SELECT * FROM audit_log WHERE action = ?').all(action);

test('新增酒款與入庫、編輯、價格', async () => {
  const { db, server, call } = await setup();
  try {
    const racks = (await call('GET', '/api/locations')).body[0].lockers[0].racks;
    let r = await call('POST', '/api/wines', { wine: { country: 'France', winery: 'Bollinger', name: 'Bollinger Test Cuvee Brut', region: 'Champagne', vintage: '2015', type_code: 'CP', volume_ml: 750 },
      stock: { qty: 6, merchant: '樂潘', cost: '3,200', dest: { mode: 'newcase', rack_id: racks[0].id } }, price: { price: 4100, date: '2026-11-18', source: '手動' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.bottle_nos.length, 6);
    assert.match(r.body.case_no, /^\d\d-\d\d-\d\d-\d\d$/);
    const no = r.body.wine_no;
    r = await call('POST', '/api/wines', { wine: { winery: 'bollinger', name: 'Bollinger Test Cuvee Brut', vintage: '2015', type_code: 'CP' } });
    assert.equal(r.status, 409);
    r = await call('GET', `/api/wines-similar?winery=Bollinger&name=Bollinger%20Test%20Cuvee%20Brut&vintage=2015`);
    assert.equal(r.body[0].qty, 6);
    r = await call('PUT', '/api/wines/' + no, { region: 'Champagne', suggested_price: 4800, notes: '試飲' });
    assert.equal(r.body.changed, 2);
    const ch = JSON.parse(logs(db, '修改酒款')[0].changes);
    assert.deepEqual(ch['建議售價'], [null, 4800]);
    r = await call('POST', `/api/wines/${no}/stock`, { qty: 2, dest: { mode: 'case', case_no: (await call('GET', '/api/wines/' + no)).body.locations[0].case_no } });
    assert.match(r.body.warning, /超過容量/);
    r = await call('POST', `/api/wines/${no}/prices`, { price: 4300 });
    assert.equal(r.status, 200);
    const w = (await call('GET', '/api/wines/' + no)).body;
    assert.equal(w.qty, 8);
    assert.equal(w.price.price, 4300);
    r = await call('POST', `/api/prices/${w.price.id}/void`, {});
    assert.equal(r.status, 400);
    r = await call('POST', `/api/prices/${w.price.id}/void`, { reason: '輸入錯誤' });
    assert.equal((await call('GET', '/api/wines/' + no)).body.price.price, 4100);
    r = await call('PUT', '/api/wines/' + no, { vintage: '15' });
    assert.equal(r.status, 400);
  } finally { server.close(); }
});

test('移動整箱、部分酒瓶、散瓶裝新箱', async () => {
  const { db, server, call } = await setup();
  try {
    const loc = (await call('GET', '/api/locations')).body[0];
    const b51 = loc.lockers.find((l) => l.code === 'B51');
    let r = await call('POST', '/api/racks', { locker_id: b51.id, code: '上層' });
    const rackId = r.body.id;
    r = await call('POST', '/api/move', { what: 'case', case_no: '04-28-22-01', dest: { rack_id: rackId } });
    assert.equal(r.body.moved, 6);
    const c = db.prepare('SELECT * FROM cases WHERE case_no = ?').get('04-28-22-01');
    assert.equal(c.location_uncertain, 0);
    assert.equal(c.rack_id, rackId);
    assert.match(JSON.parse(logs(db, '移動酒箱')[0].changes)['位置'][0], /待確認/);
    const bottles = (await call('GET', '/api/cases/04-28-22-01')).body.bottles.slice(0, 2).map((b) => b.bottle_no);
    r = await call('POST', '/api/move', { what: 'bottles', bottle_nos: bottles, dest: { mode: 'loose', rack_id: rackId } });
    assert.equal(r.body.moved, 2);
    r = await call('POST', '/api/move', { what: 'bottles', bottle_nos: bottles, dest: { mode: 'newcase', rack_id: rackId, capacity: 12 } });
    assert.ok(r.body.case_no);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM bottles WHERE case_id = (SELECT id FROM cases WHERE case_no = ?)').get(r.body.case_no).n, 2);
    r = await call('DELETE', '/api/racks/' + rackId);
    assert.equal(r.status, 400);
    r = await call('GET', '/api/resolve/' + bottles[0]);
    assert.equal(r.body.type, 'bottle');
    r = await call('GET', '/api/resolve/RACK:' + rackId);
    assert.equal(r.body.type, 'rack');
    r = await call('POST', '/api/bottles/status', { bottle_nos: [bottles[0]], status: 'broken', reason: '搬運破損' });
    assert.equal(r.body.changed, 1);
    r = await call('POST', '/api/move', { what: 'bottles', bottle_nos: [bottles[0]], dest: { mode: 'loose', rack_id: rackId } });
    assert.equal(r.status, 400);
  } finally { server.close(); }
});

test('清單、標籤、匯出', async () => {
  const { db, server, call } = await setup();
  try {
    let r = await call('POST', '/api/lists', { name: '香檳推薦', query: { type: 'CP', q: 'billiot' } });
    assert.ok(r.body.added > 0);
    const id = r.body.id;
    r = await call('POST', `/api/lists/${id}/items`, { codes: ['04-28-22-01'] });
    assert.equal(r.body.added, 1);
    let l = (await call('GET', '/api/lists/' + id)).body;
    assert.equal(l.items.length, l.wines);
    await call('DELETE', `/api/lists/${id}/items/${l.items[0].wine_no}`);
    l = (await call('GET', '/api/lists/' + id)).body;
    r = await call('POST', '/api/labels', { kind: 'bottle', list: id });
    assert.equal(r.body.labels.length, l.bottles);
    r = await call('POST', '/api/labels', { kind: 'case', list: id });
    assert.ok(r.body.labels[0].first);
    r = await call('POST', '/api/labels', { kind: 'bottle', unprinted: true });
    assert.equal(r.body.labels.length, 1026);
    await call('POST', '/api/labels/printed', { kind: 'bottle', codes: r.body.labels.slice(0, 3).map((x) => x.bottle_no) });
    assert.equal((await call('POST', '/api/labels', { kind: 'bottle', unprinted: true })).body.labels.length, 1023);
    r = await call('POST', '/api/export/xlsx', { list: id, columns: ['name', 'vintage', 'qty', 'price', 'cost'], lang: 'zh' });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.body);
    assert.equal(wb.worksheets[0].getRow(4).getCell(1).value, '品名');
    assert.equal(JSON.parse(logs(db, '匯出 Excel')[0].changes)['含採購價格'], '是');
    r = await call('POST', '/api/export/data', { query: { type: 'R' }, log: true });
    assert.ok(r.body.rows.length > 10);
    r = await call('POST', `/api/lists/${id}/copy`, {});
    assert.equal((await call('GET', '/api/lists')).body.length, 2);
  } finally { server.close(); }
});

test('設定：使用者、酒商合併、種類對應、批次上傳', async () => {
  const { db, server, call } = await setup();
  try {
    let r = await call('POST', '/api/users', { login: 'mary', name: '小美', password: '12345' });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/users', { login: 'mary', name: '小美', password: '246810' });
    const mid = r.body.id;
    r = await call('POST', `/api/users/${mid}/password`, { password: '135790' });
    assert.equal(r.status, 200);
    const me = db.prepare("SELECT id FROM users WHERE login = 'jammy'").get().id;
    r = await call('PUT', '/api/users/' + me, { active: false });
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify((await call('GET', '/api/users')).body).includes('pw_hash'));
    const ms = (await call('GET', '/api/merchants')).body;
    const from = ms.find((m) => m.name === '歐選'), to = ms.find((m) => m.name === '歐地');
    r = await call('POST', '/api/merchants/merge', { from_id: from.id, to_id: to.id });
    assert.ok(r.body.moved >= 1);
    r = await call('PUT', '/api/types/S', { merge_into: 'SP' });
    assert.equal(r.status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM wine_types WHERE mapped = 0").get().n, 0);
    // 批次：範本 → 填寫 → 預覽 → 寫入
    const t = (await call('GET', '/api/batch/users/template')).body;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t);
    const ws = wb.worksheets[0];
    ws.spliceRows(2, 1);
    ws.addRow(['tom', '湯姆', '111222', 'English', '啟用']);
    ws.addRow(['mary', '王小美', '', '', '']);
    ws.addRow(['x', '', '', '', '']);
    const fd = new FormData(); fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'u.xlsx');
    r = await call('POST', '/api/batch/users/preview', fd);
    assert.deepEqual(r.body.counts, { new: 1, update: 1, same: 0, error: 1 });
    r = await call('POST', '/api/batch/users/commit', { token: r.body.token });
    assert.equal(r.body.applied, 2);
    assert.equal(db.prepare("SELECT name FROM users WHERE login = 'mary'").get().name, '王小美');
    const ex = (await call('GET', '/api/batch/users/export')).body;
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(ex);
    assert.ok(!JSON.stringify(wb2.worksheets[0].getSheetValues()).includes('111222'));
    // 儲位批次
    const wb3 = new ExcelJS.Workbook(); const s3 = wb3.addWorksheet('x');
    s3.addRow(['酒窖', '分儲空間', '架子']); s3.addRow(['永興', 'A31', '上層']); s3.addRow(['新倉', 'Z1', '']);
    const fd3 = new FormData(); fd3.append('file', new Blob([await wb3.xlsx.writeBuffer()]), 's.xlsx');
    r = await call('POST', '/api/batch/storage/preview', fd3);
    assert.equal(r.body.counts.new, 2);
    await call('POST', '/api/batch/storage/commit', { token: r.body.token });
    assert.ok(db.prepare("SELECT 1 FROM cellars WHERE name = '新倉'").get());
    r = await call('PUT', '/api/settings/company', { name_zh: '測試酒業' });
    assert.equal(r.body.company.name_zh, '測試酒業');
    r = await call('POST', '/api/customers', { name: '陳先生', phone: '0912' });
    assert.equal(r.body.customer_no, 'C-0001');
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM audit_log').all()).match(/246810|135790|111222/));
  } finally { server.close(); }
});
