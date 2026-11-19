import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

process.env.MYWINES_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mwb-'));
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
    if (body instanceof FormData) init.body = body; else if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(U + url, init);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync('sample_data/Inventory.xlsx')]), 'Inventory.xlsx');
  const p = (await call('POST', '/api/import/preview', fd)).body;
  await call('POST', '/api/import/commit', { token: p.token });
  return { db, server, call, U };
}

test('#1 篩選選項依目前條件、#3 查價上限、#4 公司名稱', async () => {
  const { server, call, U } = await setup();
  try {
    const all = (await call('GET', '/api/facets')).body;
    const f = (await call('GET', '/api/facets?type=CP&vmin=2010&vmax=2016&pmax=3000')).body;
    assert.ok(all.regions.length > 3);
    assert.deepEqual(f.regions.map((r) => r.region), ['Champagne']);
    assert.ok(f.types.find((t) => t.code === 'R'), '種類欄位不受自己的條件限制');
    const q = (await call('GET', '/api/price/quota')).body;
    assert.deepEqual([q.per_hour, q.per_day], [100, 300]);
    await call('PUT', '/api/settings/company', { name_zh: '真實酒業' });
    const pub = await (await fetch(U + '/api/public/company')).json();
    assert.equal(pub.name_zh, '真實酒業');
  } finally { server.close(); }
});

test('#3 舊設定 20/100 自動升級', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mwm-')), 'x.db');
  const db = openDb(file);
  db.prepare("INSERT INTO settings (key, value) VALUES ('price.per_hour', '20'), ('price.per_day', '100')").run();
  db.close();
  const db2 = openDb(file);
  assert.equal(db2.prepare("SELECT value FROM settings WHERE key = 'price.per_hour'").get().value, '100');
  assert.equal(db2.prepare("SELECT value FROM settings WHERE key = 'price.per_day'").get().value, '300');
});

test('#6 訂單預設單價：上次成交 → 建議售價 → 市場價格（可加成）', async () => {
  const { db, server, call } = await setup();
  try {
    const cust = (await call('POST', '/api/customers', { name: 'Suchen' })).body;
    const w = db.prepare(`SELECT w.wine_no, (SELECT price FROM price_history p WHERE p.wine_id = w.id ORDER BY effective_date DESC, id DESC LIMIT 1) mk FROM wines w WHERE suggested_price IS NULL
      AND EXISTS (SELECT 1 FROM price_history p WHERE p.wine_id = w.id) AND (SELECT COUNT(*) FROM bottles b WHERE b.wine_id = w.id) >= 6 LIMIT 1`).get();
    let r = await call('POST', '/api/orders', { customer_id: cust.id, wine_nos: [w.wine_no] });
    let o = (await call('GET', '/api/orders/' + r.body.order_no)).body;
    assert.equal(o.lines[0].unit_price, w.mk);
    assert.equal(o.lines[0].price_source, 'market');
    await call('PUT', '/api/settings/price', { order_markup: '20' });
    r = await call('POST', '/api/orders', { customer_id: cust.id, wine_nos: [w.wine_no] });
    o = (await call('GET', '/api/orders/' + r.body.order_no)).body;
    assert.equal(o.lines[0].unit_price, Math.round(w.mk * 1.2));
    assert.equal(o.lines[0].price_source, 'market');
  } finally { server.close(); }
});

test('#7 出庫與刪除酒款', async () => {
  const { db, server, call } = await setup();
  try {
    const caseBottles = db.prepare("SELECT b.bottle_no FROM bottles b JOIN cases c ON c.id = b.case_id WHERE c.case_no = '04-28-22-01' ORDER BY b.bottle_no").all().map((r) => r.bottle_no);
    let r = await call('POST', '/api/stockout', { bottle_nos: [caseBottles[0]], reason: 'other' });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/stockout', { bottle_nos: [caseBottles[0]], reason: 'gift', note: '送王董' });
    assert.equal(r.body.count, 1);
    assert.equal(db.prepare('SELECT status, out_reason FROM bottles WHERE bottle_no = ?').get(caseBottles[0]).out_reason, '贈送：送王董');
    r = await call('POST', '/api/stockout', { bottle_nos: [caseBottles[0]], reason: 'own' });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/stockout', { case_nos: ['04-28-22-01'], reason: 'broken' });
    assert.equal(r.body.count, caseBottles.length - 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bottles WHERE status = 'broken'").get().n, caseBottles.length - 1);
    const w = db.prepare("SELECT w.wine_no, w.id FROM wines w WHERE (SELECT COUNT(*) FROM bottles b WHERE b.wine_id = w.id AND b.status = 'in_stock') >= 12 LIMIT 1").get();
    r = await call('POST', '/api/stockout', { picks: [{ wine_no: w.wine_no, qty: 2 }], reason: 'tasting' });
    assert.equal(r.body.count, 2);
    r = await call('POST', '/api/stockout', { picks: [{ wine_no: w.wine_no, qty: 999 }], reason: 'tasting' });
    assert.match(r.body.error, /在庫只有/);
    const cand = (await call('POST', '/api/stockout/candidates', { wine_nos: [w.wine_no] })).body;
    assert.equal(cand[0].wine_no, w.wine_no);
    // 保留中的酒不能出庫
    const cust = (await call('POST', '/api/customers', { name: 'X' })).body;
    const ord = (await call('POST', '/api/orders', { customer_id: cust.id, wine_nos: [w.wine_no] })).body;
    await call('PUT', '/api/orders/' + ord.order_no, { lines: [{ wine_no: w.wine_no, qty: 1, unit_price: 100 }] });
    await call('POST', `/api/orders/${ord.order_no}/confirm`);
    const held = (await call('GET', '/api/orders/' + ord.order_no)).body.lines[0].held[0].bottle_no;
    r = await call('POST', '/api/stockout', { bottle_nos: [held], reason: 'own' });
    assert.match(r.body.error, /保留/);
    // 刪除：有訂單的不行
    r = await call('GET', `/api/wines/${w.wine_no}/deletable`);
    assert.equal(r.body.ok, false);
    // 新增一款輸入錯誤的酒，再刪除
    const rack = db.prepare('SELECT id FROM racks LIMIT 1').get().id;
    const nw = (await call('POST', '/api/wines', { wine: { winery: 'Typo', name: 'Typo Wine', vintage: '2020', type_code: 'R' }, stock: { qty: 3, dest: { mode: 'newcase', rack_id: rack } } })).body;
    r = await call('DELETE', '/api/wines/' + nw.wine_no, {});
    assert.equal(r.status, 400);
    r = await call('DELETE', '/api/wines/' + nw.wine_no, { reason: '輸入錯誤' });
    assert.deepEqual([r.body.bottles, r.body.cases], [3, 1]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM wines WHERE wine_no = ?').get(nw.wine_no).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = '刪除酒款'").get().n, 1);
    // 離線出庫
    const b = db.prepare("SELECT bottle_no, rack_id, status FROM bottles WHERE status = 'in_stock' LIMIT 1").get();
    r = await call('POST', '/api/offline/sync', { ops: [{ id: crypto.randomUUID(), ts: new Date().toISOString(), type: 'stockout', payload: { bottle_nos: [b.bottle_no], reason: 'own' }, base: { bottles: { [b.bottle_no]: { rack_id: b.rack_id, case_no: null, status: 'in_stock' } } } }] });
    assert.equal(r.body.results[0].status, 'applied');
    assert.equal(db.prepare('SELECT status FROM bottles WHERE bottle_no = ?').get(b.bottle_no).status, 'out');
  } finally { server.close(); }
});
