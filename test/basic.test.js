import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

test('登入、匯入範例檔、搜尋、異動紀錄不可修改', async () => {
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  const U = `http://localhost:${server.address().port}`;
  try {
    let r = await fetch(U + '/api/search');
    assert.equal(r.status, 401);
    r = await fetch(U + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'jammy', password: '123456' }) });
    assert.equal(r.status, 200);
    const H = { cookie: r.headers.get('set-cookie').split(';')[0] };
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync('sample_data/Inventory.xlsx')]), 'Inventory.xlsx');
    const p = await (await fetch(U + '/api/import/preview', { method: 'POST', headers: H, body: fd })).json();
    const c = await (await fetch(U + '/api/import/commit', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ token: p.token }) })).json();
    assert.equal(c.bottles, 1026);
    assert.equal(c.cases, 171);
    assert.equal(c.prices, p.summary.prices);
    const s = await (await fetch(U + '/api/search?q=billiot', { headers: H })).json();
    assert.ok(s.rows.length > 0);
    assert.throws(() => db.prepare('DELETE FROM audit_log').run());
    assert.throws(() => db.prepare("UPDATE audit_log SET user_login = 'x'").run());
    const log = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
    assert.ok(!log.includes('123456'), '密碼不可出現在紀錄');
  } finally { server.close(); }
});
