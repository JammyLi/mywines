import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mwa-'));
process.env.MYWINES_DATA = DATA;
const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

test('清除資料：兩道確認、阻擋、備份、紀錄', async () => {
  const db = openDb(path.join(DATA, 't.db'));
  const server = createApp(db).listen(0);
  const U = `http://localhost:${server.address().port}`;
  const cookie = (await fetch(U + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'jammy', password: '123456' }) })).headers.get('set-cookie').split(';')[0];
  const call = async (method, url, body) => { const init = { method, headers: { cookie } }; if (body instanceof FormData) init.body = body; else if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); } const r = await fetch(U + url, init); return { status: r.status, body: await r.json() }; };
  try {
    const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync('sample_data/Inventory.xlsx')]), 'Inventory.xlsx');
    await call('POST', '/api/import/commit', { token: (await call('POST', '/api/import/preview', fd)).body.token });
    const c = (await call('POST', '/api/customers', { name: 'A' })).body;
    await call('POST', '/api/users', { login: 'amy', password: '222222' });
    const w = db.prepare('SELECT wine_no FROM wines LIMIT 1').get().wine_no;
    const o = (await call('POST', '/api/orders', { customer_id: c.id, wine_nos: [w] })).body;
    await call('PUT', '/api/orders/' + o.order_no, { lines: [{ wine_no: w, qty: 1, unit_price: 100 }] });
    await call('POST', `/api/orders/${o.order_no}/confirm`);
    const si = (await call('GET', '/api/server-info')).body;
    assert.ok(Array.isArray(si.ips) && si.urls.every((u) => u.pc.startsWith('http://')));
    let s = (await call('GET', '/api/admin/clear')).body;
    assert.match(s.customers.blocked, /訂單/);
    assert.match(s.cellars.blocked, /庫存/);
    assert.equal(s.inventory.phrase, '刪除庫存');
    let r = await call('POST', '/api/admin/clear', { scope: 'customers', phrase: '刪除客戶', password: '123456' });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/admin/clear', { scope: 'orders', phrase: '刪除', password: '123456' });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/admin/clear', { scope: 'orders', phrase: '刪除訂單', password: '000000' });
    assert.equal(r.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM orders').get().c, 1);
    r = await call('POST', '/api/admin/clear', { scope: 'orders', phrase: '刪除訂單', password: '123456' });
    assert.equal(r.body.ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM bottles WHERE status = 'reserved'").get().c, 0);
    assert.ok(fs.existsSync(path.join(DATA, 'backup', r.body.backup)));
    r = await call('POST', '/api/admin/clear', { scope: 'customers', phrase: '刪除客戶', password: '123456' });
    assert.equal(r.body.ok, true);
    const lastBottle = db.prepare("SELECT value FROM counters WHERE name = 'bottle'").get().value;
    r = await call('POST', '/api/admin/clear', { scope: 'inventory', phrase: '刪除庫存', password: '123456' });
    assert.equal(db.prepare('SELECT COUNT(*) c FROM bottles').get().c, 0);
    assert.equal(db.prepare("SELECT value FROM counters WHERE name = 'bottle'").get().value, lastBottle, '瓶號不歸零');
    r = await call('POST', '/api/admin/clear', { scope: 'cellars', phrase: '刪除酒窖', password: '123456' });
    assert.equal(db.prepare('SELECT COUNT(*) c FROM racks').get().c, 0);
    r = await call('POST', '/api/admin/clear', { scope: 'users', phrase: '刪除使用者', password: '123456' });
    assert.deepEqual(db.prepare('SELECT login FROM users').all().map((u) => u.login), ['jammy']);
    r = await call('POST', '/api/admin/clear', { scope: 'logs', phrase: '刪除異動紀錄', password: '123456' });
    const logs = db.prepare('SELECT action FROM audit_log').all();
    assert.deepEqual(logs.map((l) => l.action), ['清除異動紀錄']);
    assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /read-only/);
  } finally { server.close(); }
});

test('庫存搜尋：酒窖 › 分儲空間 › 架子 篩選與連動', async () => {
  const db = openDb(path.join(DATA, 's.db'));
  const server = createApp(db).listen(0);
  const U = `http://localhost:${server.address().port}`;
  const cookie = (await fetch(U + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'jammy', password: '123456' }) })).headers.get('set-cookie').split(';')[0];
  const get = async (u) => (await fetch(U + u, { headers: { cookie } })).json();
  try {
    const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync('sample_data/Inventory.xlsx')]), 'Inventory.xlsx');
    const pv = await (await fetch(U + '/api/import/preview', { method: 'POST', headers: { cookie }, body: fd })).json();
    await fetch(U + '/api/import/commit', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ token: pv.token }) });
    const k = db.prepare("SELECT k.id rack, l.id locker, l.cellar_id cellar, COUNT(*) n FROM bottles b JOIN racks k ON k.id = b.rack_id JOIN lockers l ON l.id = k.locker_id WHERE b.status = 'in_stock' GROUP BY k.id ORDER BY n DESC LIMIT 1").get();
    const all = await get('/api/search');
    const byCellar = await get('/api/search?cellar=' + k.cellar);
    const byRack = await get(`/api/search?cellar=${k.cellar}&locker=${k.locker}&rack=${k.rack}`);
    assert.ok(byCellar.totals.bottles <= all.totals.bottles);
    assert.equal(byRack.totals.bottles, k.n);
    assert.ok('cellars' in byRack.rows[0] && 'racks' in byRack.rows[0]);
    const fc = await get('/api/facets?locker=' + k.locker);
    assert.ok(fc.racks.every((r) => db.prepare('SELECT locker_id FROM racks WHERE id = ?').get(r.id).locker_id === k.locker), '架子只列出這個分儲空間的');
    assert.ok(fc.lockers.length >= 1);
    const f = await get('/api/filters');
    assert.ok(f.cellars.length && f.racks[0].locker_id);
  } finally { server.close(); }
});
