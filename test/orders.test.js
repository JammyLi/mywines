import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

process.env.MYWINES_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mwo-'));
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
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync('sample_data/Inventory.xlsx')]), 'Inventory.xlsx');
  const p = (await call('POST', '/api/import/preview', fd)).body;
  await call('POST', '/api/import/commit', { token: p.token });
  return { db, server, call };
}

test('訂單：草稿 → 確認保留 → 掃描出貨（含換瓶）、取消釋放、客戶歷史價', async () => {
  const { db, server, call } = await setup();
  try {
    const cust = (await call('POST', '/api/customers', { name: '陳先生', discount: 5 })).body;
    await call('POST', `/api/customers/${cust.id}/addresses`, { label: '家', address: '台北市大安區 1 號', is_default: true });
    const list = (await call('POST', '/api/lists', { name: '推薦', codes: ['04-28-22-01', '09-07-23-06'] })).body;
    let r = await call('POST', '/api/orders', { customer_id: cust.id, list_id: list.id });
    const no = r.body.order_no;
    assert.match(no, /^SO-\d{8}-001$/);
    let o = (await call('GET', '/api/orders/' + no)).body;
    assert.equal(o.lines.length, 2);
    assert.equal(o.order.address, '台北市大安區 1 號');
    assert.equal(o.lines[0].discount, 5);
    assert.ok(o.lines.every((l) => l.unit_price == null || l.price_source === 'market')); // 沒有建議售價時用市場價格
    const lines = o.lines.map((l, i) => ({ wine_no: l.wine_no, qty: i === 0 ? 4 : 2, unit_price: i === 0 ? 3000 : 2500, discount: i === 0 ? 5 : 0 }));
    r = await call('PUT', '/api/orders/' + no, { lines, shipping_fee: 200, delivery_date: '2026-11-25' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // 4×3000×0.95 = 11400；2×2500 = 5000；小計 16400；稅 820；運費 200
    assert.deepEqual([r.body.totals.subtotal, r.body.totals.tax, r.body.totals.total], [16400, 820, 17420]);
    r = await call('PUT', '/api/orders/' + no, { lines: [...lines, { wine_no: lines[0].wine_no, qty: 1, unit_price: 1 }] });
    assert.equal(r.status, 400);
    r = await call('POST', `/api/orders/${no}/confirm`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.order.status, 'confirmed');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bottles WHERE status = 'reserved'").get().n, 6);
    assert.equal((await call('PUT', '/api/orders/' + no, { note: 'x' })).status, 400);
    // 出貨：掃 1 瓶不同的同款在庫瓶（換瓶），其餘照保留
    const w0 = r.body.lines[0];
    const other = db.prepare("SELECT b.bottle_no FROM bottles b JOIN wines w ON w.id = b.wine_id WHERE w.wine_no = ? AND b.status = 'in_stock' LIMIT 1").get(w0.wine_no);
    r = await call('POST', `/api/orders/${no}/ship`, { bottle_nos: [other.bottle_no] });
    assert.equal(r.status, 400); // 數量不足（沒選照保留）
    r = await call('POST', `/api/orders/${no}/ship`, { bottle_nos: ['B-9999999'] , use_reserved: true });
    assert.equal(r.status, 400);
    r = await call('POST', `/api/orders/${no}/ship`, { bottle_nos: [other.bottle_no], use_reserved: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bottles WHERE status = 'shipped'").get().n, 6);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bottles WHERE status = 'reserved'").get().n, 0);
    assert.equal(db.prepare('SELECT status FROM bottles WHERE bottle_no = ?').get(other.bottle_no).status, 'shipped');
    // 第二張訂單：預設單價 = 上次成交價
    r = await call('POST', '/api/orders', { customer_id: cust.id, wine_nos: [w0.wine_no] });
    const no2 = r.body.order_no;
    o = (await call('GET', '/api/orders/' + no2)).body;
    assert.equal(o.lines[0].unit_price, 3000);
    assert.equal(o.lines[0].last_price.p, 3000);
    await call('POST', `/api/orders/${no2}/confirm`);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bottles WHERE status = 'reserved'").get().n, 1);
    // 手動把保留的瓶改成破損 → 從訂單移除
    const held = (await call('GET', '/api/orders/' + no2)).body.lines[0].held[0].bottle_no;
    await call('POST', '/api/bottles/status', { bottle_nos: [held], status: 'broken', reason: '破損' });
    assert.equal((await call('GET', '/api/orders/' + no2)).body.lines[0].held.length, 0);
    r = await call('POST', `/api/orders/${no2}/cancel`, {});
    assert.equal(r.status, 400);
    r = await call('POST', `/api/orders/${no2}/cancel`, { reason: '客戶改期' });
    assert.equal(r.body.order.status, 'cancelled');
    // 庫存不足
    r = await call('POST', '/api/orders', { customer_id: cust.id, wine_nos: [w0.wine_no] });
    await call('PUT', '/api/orders/' + r.body.order_no, { lines: [{ wine_no: w0.wine_no, qty: 999, unit_price: 1 }] });
    r = await call('POST', `/api/orders/${r.body.order_no}/confirm`);
    assert.match(r.body.error, /庫存不足/);
    // 客戶頁、列表、匯出
    const c = (await call('GET', '/api/customers/' + cust.id)).body;
    assert.equal(c.orders.length, 3);
    assert.equal(c.spent, 17420);
    assert.ok(c.prices.length >= 2);
    const list2 = (await call('GET', '/api/orders')).body;
    assert.deepEqual(list2.counts, { shipped: 1, cancelled: 1, draft: 1 });
    const x = (await call('GET', '/api/orders-export')).body;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x);
    assert.equal(wb.worksheets.length, 2);
    const acts = db.prepare("SELECT action FROM audit_log WHERE category = '銷售'").all().map((a) => a.action);
    for (const a of ['建立訂單', '修改訂單', '確認訂單', '出貨', '取消訂單']) assert.ok(acts.includes(a), a);
  } finally { server.close(); }
});
