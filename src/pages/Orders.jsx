import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ntd, num } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { Modal, download, run } from '../ui.jsx';

export const ORDER_STATUS = { draft: ['草稿', 'Draft', ''], confirmed: ['已確認', 'Confirmed', 'wine'], shipped: ['已出貨', 'Shipped', 'ok'], cancelled: ['已取消', 'Cancelled', 'warn'] };
export const StatusTag = ({ s, zh }) => <span className={'tag ' + ORDER_STATUS[s][2]}>{ORDER_STATUS[s][zh ? 0 : 1]}</span>;

// 選客戶後建立訂單；body 可帶 list_id / wine_nos / query
export function NewOrder({ zh, body = {}, onClose }) {
  const nav = useNavigate();
  const { data: customers } = useApi('/api/customers');
  const [cid, setCid] = useState('');
  const go = async () => {
    const r = await run(() => api('/api/orders', { method: 'POST', body: { ...body, customer_id: cid || null } }), (r) => (zh ? `已建立訂單 ${r.order_no}` : `Order ${r.order_no} created`));
    onClose(); nav('/orders/' + r.order_no);
  };
  return (
    <Modal title={zh ? '建立訂單' : 'New order'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" onClick={go}>{zh ? '建立草稿' : 'Create draft'}</button></>}>
      <label className="f">{zh ? '客戶' : 'Customer'}<select className="input" value={cid} onChange={(e) => setCid(e.target.value)}>
        <option value="">{zh ? '（稍後再選）' : '(choose later)'}</option>{customers?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.customer_no} {c.name}</option>)}</select></label>
      <div className="muted small">{zh ? '單價預設帶入這位客戶上次的成交價，沒有的話帶建議售價；折扣帶入客戶的預設折扣。都可以再改。' : 'Prices default to this customer’s last price, else the suggested price.'}</div>
      <Link className="small" to="/settings/customers" onClick={onClose}>{zh ? '＋ 新增客戶' : '+ Add a customer'}</Link>
    </Modal>
  );
}

export default function Orders() {
  const t = useT();
  const zh = t.lang !== 'en';
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || '';
  const [q, setQ] = useState(sp.get('q') || '');
  const [kw, setKw] = useState(q);
  const [neu, setNeu] = useState(false);
  useEffect(() => { const tm = setTimeout(() => setKw(q), 300); return () => clearTimeout(tm); }, [q]);
  const { data } = useApi(`/api/orders?status=${status}&q=${encodeURIComponent(kw)}`);
  const all = data ? Object.values(data.counts).reduce((s, n) => s + n, 0) : 0;
  const tabs = [['', zh ? '全部' : 'All', all], ...Object.entries(ORDER_STATUS).map(([k, v]) => [k, v[zh ? 0 : 1], data?.counts[k] || 0])];
  return (
    <div className="page">
      <div className="row between"><h1>{zh ? '訂單' : 'Orders'}</h1>
        <div className="row"><button className="btn" onClick={() => run(() => download('/api/orders-export' + (status ? '?status=' + status : ''), null, 'orders.xlsx'))}>{zh ? '匯出 Excel' : 'Export Excel'}</button>
          <button className="btn primary" onClick={() => setNeu(true)}>{zh ? '＋ 建立訂單' : '+ New order'}</button></div></div>
      <nav className="tabs">{tabs.map(([k, l, n]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setSp(k ? { status: k } : {})}>{l} <span className="muted small">{n}</span></button>)}</nav>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={zh ? '搜尋訂單編號、客戶、備註' : 'Search order no., customer, note'} style={{ maxWidth: 420 }} />
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr><th>{zh ? '訂單編號' : 'Order no.'}</th><th>{zh ? '日期' : 'Date'}</th><th>{zh ? '客戶' : 'Customer'}</th><th className="num">{zh ? '瓶數' : 'Bottles'}</th><th className="num">{zh ? '總金額（含稅）' : 'Total (incl. tax)'}</th><th>{zh ? '狀態' : 'Status'}</th><th>{zh ? '業務人員' : 'Sales'}</th></tr></thead>
        <tbody>{data?.rows.map((o) => <tr key={o.id}><td><Link to={'/orders/' + o.order_no}>{o.order_no}</Link></td><td>{o.order_date}</td><td>{o.customer ? <Link to={'/customers/' + o.customer_id}>{o.customer}</Link> : <span className="muted">—</span>}</td>
          <td className="num">{num(o.bottles)}</td><td className="num">{ntd(o.total)}</td><td><StatusTag s={o.status} zh={zh} /></td><td>{o.created_by}</td></tr>)}</tbody>
      </table></div>
      {data && !data.rows.length && <div className="card muted">{zh ? '沒有訂單。可以從「我的清單」按「轉成訂單」，或按右上角建立。' : 'No orders yet.'}</div>}
      {neu && <NewOrder zh={zh} onClose={() => setNeu(false)} />}
    </div>
  );
}
