import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';

process.env.MYWINES_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mw3-'));
const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { ensureTls } = await import('../server/tls.js');

async function setup() {
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  const U = `http://localhost:${server.address().port}`;
  const login = async (l, p) => (await fetch(U + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) })).headers.get('set-cookie').split(';')[0];
  const mk = (cookie) => async (method, url, body) => {
    const init = { method, headers: { cookie } };
    if (body instanceof FormData) init.body = body; else if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(U + url, init);
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  const call = mk(await login('jammy', '123456'));
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync('sample_data/Inventory.xlsx')]), 'Inventory.xlsx');
  const p = (await call('POST', '/api/import/preview', fd)).body;
  await call('POST', '/api/import/commit', { token: p.token });
  return { db, server, call, mk, login };
}

test('查價助手：速度限制與價格確認', async () => {
  const { db, server, call } = await setup();
  try {
    let r = await call('POST', '/api/lists', { name: '查價', codes: ['04-28-22-01', '09-07-23-06'] });
    const q = (await call('GET', '/api/price/queue?list=' + r.body.id)).body;
    assert.equal(q.items.length, 2);
    assert.match(q.items[0].url, /^https:\/\/www\.wine-searcher\.com\/find\//);
    r = await call('POST', '/api/price/open', { wine_no: q.items[0].wine_no });
    assert.equal(r.status, 200);
    assert.ok(r.body.quota.wait_ms >= 9000 && r.body.quota.wait_ms <= 20000, 'wait ' + r.body.quota.wait_ms);
    const lookup = r.body.lookup_id;
    r = await call('POST', '/api/price/open', { wine_no: q.items[1].wine_no });
    assert.equal(r.status, 429);
    const cur = q.items[0].price;
    r = await call('POST', '/api/price/save', { wine_no: q.items[0].wine_no, price: cur * 2, lookup_id: lookup, url: 'https://www.wine-searcher.com/find/x' });
    assert.equal(r.status, 409);
    r = await call('POST', '/api/price/save', { wine_no: q.items[0].wine_no, price: cur * 2, lookup_id: lookup, url: 'https://www.wine-searcher.com/find/x', confirm: true });
    assert.equal(r.status, 200);
    assert.equal(db.prepare('SELECT result FROM price_lookups WHERE id = ?').get(lookup).result, 'saved');
    // 每小時上限
    await call('PUT', '/api/settings/price', { per_hour: '1', min_wait: '0', max_wait: '0' });
    await new Promise((s) => setTimeout(s, 30));
    r = await call('POST', '/api/price/open', { wine_no: q.items[1].wine_no });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /小時/);
    // 批次
    r = await call('POST', '/api/prices/batch', { source: '酒商報價', items: [{ wine_no: q.items[1].wine_no, price: q.items[1].price * 3 }, { wine_no: q.items[0].wine_no, price: '' }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.big.length, 1);
    r = await call('POST', '/api/prices/batch', { source: '酒商報價', items: [{ wine_no: q.items[1].wine_no, price: q.items[1].price * 3 }], confirm: [q.items[1].wine_no] });
    assert.equal(r.body.saved, 1);
    // Excel
    const t = (await call('GET', '/api/batch/prices/template')).body;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t);
    const ws = wb.worksheets[0];
    assert.ok(ws.rowCount > 100);
    ws.getRow(2).getCell(5).value = 1234;
    ws.getRow(3).getCell(5).value = 'abc';
    const fd = new FormData(); fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'p.xlsx');
    r = await call('POST', '/api/batch/prices/preview', fd);
    assert.deepEqual([r.body.counts.new, r.body.counts.error], [1, 1]);
    await call('POST', '/api/batch/prices/commit', { token: r.body.token });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = '更新市場價格（Excel）'").get().n, 1);
  } finally { server.close(); }
});

test('手機離線同步：套用、重複上傳、衝突、盤點', async () => {
  const { db, server, call, mk, login } = await setup();
  try {
    await call('POST', '/api/users', { login: 'amy', password: '222222' });
    const amy = mk(await login('amy', '222222'));
    const snap = (await call('GET', '/api/offline/snapshot')).body;
    assert.ok(snap.bottles.length >= 1026);
    assert.ok(!JSON.stringify(snap).match(/purchase_price|cost|merchant/));
    const b51 = snap.lockers.find((l) => l.code === 'B51');
    const rack = snap.racks.find((r) => r.locker_id === b51.id);
    const inCase = snap.bottles.filter((b) => b.case_no === '04-28-22-01').slice(0, 3);
    const base = (list) => ({ bottles: Object.fromEntries(list.map((b) => [b.bottle_no, { rack_id: b.rack_id, case_no: b.case_no, status: b.status }])) });
    const op1 = { id: crypto.randomUUID(), ts: new Date().toISOString(), type: 'move_bottles', payload: { bottle_nos: [inCase[0].bottle_no], dest: { mode: 'loose', rack_id: rack.id } }, base: base([inCase[0]]) };
    // amy 在 jammy 離線時先移動了 inCase[1]
    await amy('POST', '/api/move', { what: 'bottles', bottle_nos: [inCase[1].bottle_no], dest: { mode: 'loose', rack_id: rack.id } });
    const op2 = { id: crypto.randomUUID(), ts: new Date().toISOString(), type: 'move_bottles', payload: { bottle_nos: [inCase[1].bottle_no], dest: { mode: 'newcase', rack_id: rack.id } }, base: base([inCase[1]]) };
    const op3 = { id: crypto.randomUUID(), ts: new Date().toISOString(), type: 'status', payload: { bottle_nos: [inCase[2].bottle_no], status: 'broken', reason: '木塞污染' }, base: base([inCase[2]]) };
    const op4 = { id: crypto.randomUUID(), ts: new Date().toISOString(), type: 'list_create', payload: { name: '盤點清單', codes: ['LOCKER:' + b51.id] } };
    const caseRack = snap.racks.find((r) => r.id === snap.cases.find((c) => c.case_no === '04-28-22-01').rack_id);
    const op5 = { id: crypto.randomUUID(), ts: new Date().toISOString(), type: 'count', payload: { locker_id: caseRack.locker_id, codes: ['04-28-22-01', 'CASE:09-07-23-06', 'XYZ'] } };
    const op6 = { id: crypto.randomUUID(), ts: new Date().toISOString(), type: 'move_bottles', payload: { bottle_nos: ['B-9999999'], dest: { mode: 'loose', rack_id: rack.id } }, base: {} };
    let r = await call('POST', '/api/offline/sync', { device: 'iphone', ops: [op1, op2, op3, op4, op5, op6] });
    assert.deepEqual(r.body.results.map((x) => x.status), ['applied', 'conflict', 'applied', 'applied', 'applied', 'rejected']);
    assert.match(r.body.results[1].conflict.diffs[0].now, /B51/);
    assert.equal(r.body.results[1].conflict.by.user_login, 'amy');
    r = await call('POST', '/api/offline/sync', { device: 'iphone', ops: [op1] });
    assert.equal(r.body.results[0].status, 'applied');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = '移動酒瓶（離線同步）'").get().n, 1);
    const st = db.prepare('SELECT * FROM stocktakes').get();
    const rep = JSON.parse(st.report);
    assert.equal(rep.found.length, 1);
    assert.equal(rep.elsewhere[0].code, '09-07-23-06');
    assert.deepEqual(rep.unknown, ['XYZ']);
    const conflicts = (await call('GET', '/api/offline/conflicts')).body;
    assert.equal(conflicts.length, 1);
    r = await call('POST', '/api/offline/resolve', { id: conflicts[0].id, choice: 'mine' });
    assert.ok(r.body.result.case_no);
    assert.equal((await call('GET', '/api/offline/conflicts')).body.length, 0);
    assert.equal((await call('GET', '/api/stocktakes')).body.length, 1);
  } finally { server.close(); }
});

test('HTTPS 憑證：CA 簽發，含內網 IP', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'));
  const t = ensureTls(dir);
  const ca = new crypto.X509Certificate(t.ca), cert = new crypto.X509Certificate(t.cert);
  assert.ok(cert.verify(ca.publicKey));
  assert.match(cert.subjectAltName, /IP Address:127\.0\.0\.1/);
  assert.ok(ca.ca);
  const again = ensureTls(dir);
  assert.equal(again.fresh, false);
});
