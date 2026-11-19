import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ntd } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { run } from '../ui.jsx';
import { StatusTag } from './Orders.jsx';
import { Loading } from './parts.jsx';

export default function CustomerDetail() {
  const { id } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const [v, setV] = useState(0);
  const st = useApi(`/api/customers/${id}?v=${v}`);
  const [addr, setAddr] = useState({ label: '', address: '', is_default: false });
  if (!st.data) return <Loading state={st} />;
  const { customer: c, addresses, orders, prices, spent } = st.data;
  const byWine = new Map();
  for (const p of prices) { if (!byWine.has(p.wine_no)) byWine.set(p.wine_no, []); byWine.get(p.wine_no).push(p); }
  const newOrder = async () => { const r = await run(() => api('/api/orders', { method: 'POST', body: { customer_id: c.id } })); location.href = '/orders/' + r.order_no; };
  return (
    <div className="page">
      <div className="crumbs"><Link to="/settings/customers">{zh ? '客戶' : 'Customers'}</Link>›<span>{c.customer_no}</span></div>
      <div className="row between"><div><h1>{c.name}</h1><div className="muted">{c.customer_no} · {c.kind}{c.tax_id ? ` · ${zh ? '統編' : 'Tax ID'} ${c.tax_id}` : ''}</div></div>
        <button className="btn primary" onClick={newOrder}>{zh ? '＋ 建立訂單' : '+ New order'}</button></div>
      <div className="grid g4">
        <div className="card kpi"><div className="l">{zh ? '訂單' : 'Orders'}</div><div className="v">{orders.length}</div></div>
        <div className="card kpi"><div className="l">{zh ? '已出貨金額（含稅）' : 'Shipped total'}</div><div className="v">{ntd(spent)}</div></div>
        <div className="card kpi"><div className="l">{zh ? '預設折扣' : 'Default discount'}</div><div className="v">{c.discount != null ? c.discount + '%' : '—'}</div></div>
        <div className="card kpi"><div className="l">{zh ? '偏好語言' : 'Language'}</div><div className="v" style={{ fontSize: 20 }}>{c.lang === 'en' ? 'English' : '繁體中文'}</div></div>
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card"><h2>{zh ? '聯絡資料' : 'Contact'}</h2><dl className="dl">
          <dt>{zh ? '聯絡人' : 'Contact'}</dt><dd>{c.contact || '—'}</dd><dt>{zh ? '電話' : 'Phone'}</dt><dd>{c.phone || '—'}</dd><dt>Email</dt><dd>{c.email || '—'}</dd><dt>{zh ? '備註' : 'Note'}</dt><dd>{c.note || '—'}</dd></dl>
          <Link className="small" to="/settings/customers">{zh ? '編輯客戶資料 ›' : 'Edit ›'}</Link></div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><h2>{zh ? '送貨地址' : 'Addresses'}</h2>
          {c.address && <div className="small">{c.address} <span className="tag">{zh ? '客戶資料' : 'profile'}</span></div>}
          {addresses.map((a) => <div key={a.id} className="row between small"><span>{a.label && <b>{a.label}：</b>}{a.address}{a.is_default ? <span className="tag wine" style={{ marginLeft: 6 }}>{zh ? '預設' : 'default'}</span> : null}</span>
            <button className="btn ghost mini" onClick={async () => { await run(() => api('/api/addresses/' + a.id, { method: 'DELETE' })); setV(v + 1); }}>×</button></div>)}
          <div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" style={{ width: 90 }} placeholder={zh ? '標籤' : 'Label'} value={addr.label} onChange={(e) => setAddr({ ...addr, label: e.target.value })} />
            <input className="input" placeholder={zh ? '新增送貨地址' : 'New address'} value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} />
            <button className="btn" disabled={!addr.address.trim()} onClick={async () => { await run(() => api(`/api/customers/${c.id}/addresses`, { method: 'POST', body: { ...addr, is_default: !addresses.length } })); setAddr({ label: '', address: '', is_default: false }); setV(v + 1); }}>{zh ? '新增' : 'Add'}</button></div>
        </div>
      </div>
      <div className="card"><h2>{zh ? '歷史訂單' : 'Orders'}</h2>
        <div className="tbl-wrap"><table className="tbl stack"><thead><tr><th>{zh ? '訂單編號' : 'Order'}</th><th>{zh ? '日期' : 'Date'}</th><th className="num">{zh ? '瓶數' : 'Bottles'}</th><th className="num">{zh ? '總金額' : 'Total'}</th><th>{zh ? '狀態' : 'Status'}</th></tr></thead>
          <tbody>{orders.map((o) => <tr key={o.id}><td><Link to={'/orders/' + o.order_no}>{o.order_no}</Link></td><td>{o.order_date}</td><td className="num">{o.bottles}</td><td className="num">{ntd(o.total)}</td><td><StatusTag s={o.status} zh={zh} /></td></tr>)}</tbody></table></div>
        {!orders.length && <div className="muted small">{zh ? '還沒有訂單' : 'No orders yet'}</div>}</div>
      <div className="card"><h2>{zh ? '各酒款歷史成交價' : 'Prices by wine'}</h2>
        <div className="tbl-wrap"><table className="tbl stack"><thead><tr><th>{zh ? '酒款' : 'Wine'}</th><th>{zh ? '成交紀錄（新 → 舊）' : 'History (newest first)'}</th></tr></thead>
          <tbody>{[...byWine.entries()].map(([wno, ps]) => <tr key={wno}><td><Link to={'/wines/' + wno}>{ps[0].name}</Link><div className="sub">{ps[0].vintage}</div></td>
            <td className="small">{ps.map((p) => <div key={p.order_no}>{p.order_date} · <Link to={'/orders/' + p.order_no}>{p.order_no}</Link> · {p.qty} × {ntd(p.unit_price)}{p.discount ? ` −${p.discount}%` : ''}</div>)}</td></tr>)}</tbody></table></div>
        {!byWine.size && <div className="muted small">{zh ? '確認或出貨的訂單會出現在這裡' : 'Confirmed or shipped orders appear here'}</div>}</div>
    </div>
  );
}
