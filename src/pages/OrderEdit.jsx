import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ntd, num } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { CodeInput, Modal, run, toast } from '../ui.jsx';
import { LogTable } from './parts.jsx';
import { StatusTag } from './Orders.jsx';

const amount = (l) => Math.round((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount) || 0) / 100));

export default function OrderEdit() {
  const { no } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [lines, setLines] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [cancel, setCancel] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data: customers } = useApi('/api/customers');
  const load = (x) => {
    setD(x);
    setF({ customer_id: x.order.customer_id || '', order_date: x.order.order_date, delivery_date: x.order.delivery_date || '', lang: x.order.lang, address: x.order.address || '', note: x.order.note || '', shipping_fee: x.order.shipping_fee, tax_rate: x.order.tax_rate });
    setLines(x.lines.map((l) => ({ ...l, orig_price: l.unit_price ?? '', qty: String(l.qty), unit_price: l.unit_price ?? '', discount: l.discount ? String(l.discount) : '' })));
    setDirty(false);
  };
  useEffect(() => { api('/api/orders/' + no).then(load).catch((e) => toast(e.message, 'err')); }, [no]);
  const [addrs, setAddrs] = useState([]);
  useEffect(() => { if (f?.customer_id) api('/api/customers/' + f.customer_id).then((c) => setAddrs([...c.addresses.map((a) => a.address), c.customer.address].filter(Boolean))).catch(() => setAddrs([])); else setAddrs([]); }, [f?.customer_id]);
  if (!d || !f) return <div className="page muted">{t('loading')}</div>;
  const o = d.order;
  const editable = o.status === 'draft';
  const setL = (i, patch) => { setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l))); setDirty(true); };
  const setFf = (patch) => { setF({ ...f, ...patch }); setDirty(true); };
  const subtotal = lines.reduce((s, l) => s + amount(l), 0);
  const tax = Math.round(subtotal * (Number(f.tax_rate) || 0) / 100);
  const total = subtotal + tax + (Number(f.shipping_fee) || 0);
  const cost = lines.reduce((s, l) => s + (l.cost || 0) * (Number(l.qty) || 0), 0);
  const margin = subtotal - cost;
  const body = () => ({ ...f, customer_id: f.customer_id || null, lines: lines.map((l) => ({ wine_no: l.wine_no, qty: l.qty, unit_price: l.unit_price, discount: l.discount })) });
  const save = async (quiet) => { const x = await run(() => api('/api/orders/' + no, { method: 'PUT', body: body() }), quiet ? null : (zh ? '已儲存草稿' : 'Draft saved')); load(x); return x; };
  const act = async (path, msg, b) => {
    setBusy(true);
    try { if (editable && dirty) await save(true); load(await run(() => api(`/api/orders/${no}/${path}`, { method: 'POST', body: b || {} }), msg)); } catch { /* */ } finally { setBusy(false); }
  };
  const addCodes = async (codes) => {
    if (dirty) await save(true);
    await run(() => api(`/api/orders/${no}/lines`, { method: 'POST', body: { codes } }), (r) => (zh ? `已加入 ${r.added} 款` : `Added ${r.added}`));
    load(await api('/api/orders/' + no));
  };
  return (
    <div className="page">
      <div className="crumbs"><Link to="/orders">{zh ? '訂單' : 'Orders'}</Link>›<span>{o.order_no}</span></div>
      <div className="row between">
        <div><h1>{o.order_no} <StatusTag s={o.status} zh={zh} /></h1>
          <div className="muted small">{d.list ? <>{zh ? '從清單「' : 'From list "'}<Link to={'/lists/' + d.list.id}>{d.list.name}</Link>{zh ? '」建立 · ' : '" · '}</> : null}{o.created_by} · {o.created_at.slice(0, 16)}
            {o.status === 'cancelled' && <> · {zh ? '取消原因：' : 'Reason: '}{o.cancel_reason}</>}</div></div>
        <div className="row">
          <a className="btn" href={`/print/order/${no}?kind=customer`} target="_blank" rel="noreferrer">{zh ? '客戶版 PDF' : 'Customer PDF'}</a>
          {o.status !== 'cancelled' && <a className="btn" href={`/print/order/${no}?kind=pick`} target="_blank" rel="noreferrer">{zh ? '揀貨單' : 'Picking list'}</a>}
          {editable && <button className="btn" disabled={busy || !dirty} onClick={() => save()}>{zh ? '儲存草稿' : 'Save draft'}</button>}
          {editable && <button className="btn primary" disabled={busy || !lines.length} onClick={() => act('confirm', (x) => (zh ? `已確認，保留 ${x.totals.bottles} 瓶` : 'Confirmed'))}>{zh ? '確認訂單（保留庫存）' : 'Confirm (reserve stock)'}</button>}
          {o.status === 'confirmed' && <><button className="btn" disabled={busy} onClick={() => act('unconfirm', zh ? '已改回草稿，保留已釋放' : 'Back to draft')}>{zh ? '改回草稿' : 'Back to draft'}</button>
            <Link className="btn primary" to={`/orders/${no}/ship`}>{zh ? '出貨（掃描瓶號）' : 'Ship (scan)'}</Link></>}
          {(o.status === 'shipped' || o.status === 'cancelled') && <button className="btn" onClick={async () => { const r = await run(() => api(`/api/orders/${no}/copy`, { method: 'POST' }), zh ? '已複製成新草稿' : 'Copied'); nav('/orders/' + r.order_no); }}>{zh ? '複製成新訂單' : 'Copy'}</button>}
          {(o.status === 'draft' || o.status === 'confirmed') && <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={() => setCancel('')}>{zh ? '取消訂單' : 'Cancel order'}</button>}
        </div>
      </div>
      <div className="card grid g4" style={{ gap: 12 }}>
        <label className="f">{zh ? '客戶' : 'Customer'}<select className="input" disabled={!editable} value={f.customer_id} onChange={(e) => setFf({ customer_id: e.target.value, address: '' , lang: customers?.find((c) => String(c.id) === e.target.value)?.lang || f.lang })}>
          <option value="">—</option>{customers?.map((c) => <option key={c.id} value={c.id}>{c.customer_no} {c.name}</option>)}</select>
          {d.customer && <Link className="small" to={'/customers/' + d.customer.id}>{zh ? '客戶頁 ›' : 'Customer page ›'}</Link>}</label>
        <label className="f">{zh ? '訂單日期' : 'Order date'}<input className="input" type="date" disabled={!editable} value={f.order_date} onChange={(e) => setFf({ order_date: e.target.value })} /></label>
        <label className="f">{zh ? '預計交貨日' : 'Delivery date'}<input className="input" type="date" disabled={!editable} value={f.delivery_date} onChange={(e) => setFf({ delivery_date: e.target.value })} /></label>
        <label className="f">{zh ? '文件語言' : 'Document language'}<select className="input" disabled={!editable} value={f.lang} onChange={(e) => setFf({ lang: e.target.value })}><option value="zh">繁體中文{d.customer?.lang === 'zh' ? (zh ? '（客戶偏好）' : ' (preferred)') : ''}</option><option value="en">English{d.customer?.lang === 'en' ? (zh ? '（客戶偏好）' : ' (preferred)') : ''}</option></select></label>
        <label className="f" style={{ gridColumn: 'span 2' }}>{zh ? '送貨地址' : 'Delivery address'}<input className="input" list="addrs" disabled={!editable} value={f.address} onChange={(e) => setFf({ address: e.target.value })} /><datalist id="addrs">{addrs.map((a) => <option key={a} value={a} />)}</datalist></label>
        <label className="f" style={{ gridColumn: 'span 2' }}>{zh ? '備註（會印在客戶版）' : 'Note (printed)'}<input className="input" disabled={!editable} value={f.note} onChange={(e) => setFf({ note: e.target.value })} /></label>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0 }}>{zh ? '酒款' : 'Wines'}</h2>
        <div className="tbl-wrap"><table className="tbl stack">
          <thead><tr><th>{zh ? '酒款' : 'Wine'}</th><th>{o.status === 'draft' ? (zh ? '出貨位置' : 'Pick from') : (zh ? '保留／出貨瓶號' : 'Bottles')}</th><th className="num">{zh ? '可用' : 'Avail.'}</th><th style={{ width: 80 }}>{zh ? '數量' : 'Qty'}</th><th style={{ width: 110 }}>{zh ? '單價（NT$）' : 'Price (NT$)'}</th><th style={{ width: 80 }}>{zh ? '折扣 %' : 'Disc. %'}</th><th className="num">{zh ? '小計' : 'Amount'}</th>{editable && <th></th>}</tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.wine_no}>
              <td><Link to={'/wines/' + l.wine_no}>{l.name}</Link><div className="sub">{l.vintage} · {zh ? l.type_zh : l.type_en}</div>
                <div className="sub">{l.last_price ? (zh ? `客戶上次成交 ${ntd(l.last_price.p)}（${l.last_price.d}）` : `Last sold ${ntd(l.last_price.p)}`) : (zh ? '客戶上次成交 —' : 'No previous sale')} · {l.suggested_price ? (zh ? `建議售價 ${ntd(l.suggested_price)}` : `Suggested ${ntd(l.suggested_price)}`) : (zh ? '建議售價未設定' : 'No suggested price')}{l.market ? ` · ${zh ? '市場' : 'Market'} ${ntd(l.market)}` : ''}</div></td>
              <td className="small">{l.held.length ? <>{[...new Set(l.held.map((b) => b.location + (b.case_no ? ' › ' + b.case_no : '')))].slice(0, 3).map((x) => <div key={x}>{x}</div>)}<div className="sub">{l.held.length} {zh ? '瓶' : 'btl'} {l.held[0].state === 'shipped' ? (zh ? '已出貨' : 'shipped') : (zh ? '已保留' : 'reserved')}</div></>
                : l.locations?.length ? l.locations.slice(0, 2).map((x) => <div key={(x.case_no || '') + x.rack_id}>{x.location}{x.case_no ? ' › ' + x.case_no : ''} <span className="muted">({x.n})</span></div>) : '—'}</td>
              <td className="num">{l.available}{Number(l.qty) > l.available && o.status === 'draft' && <div className="sub" style={{ color: 'var(--err)' }}>{zh ? '不足' : 'short'}</div>}</td>
              <td><input className="input" style={{ minHeight: 34 }} inputMode="numeric" disabled={!editable} value={l.qty} onChange={(e) => setL(i, { qty: e.target.value.replace(/\D/g, '') })} aria-label={zh ? '數量' : 'Qty'} /></td>
              <td><input className="input" style={{ minHeight: 34 }} inputMode="numeric" disabled={!editable} value={l.unit_price} onChange={(e) => setL(i, { unit_price: e.target.value.replace(/\D/g, '') })} aria-label={zh ? '單價' : 'Price'} placeholder={l.suggested_price ? String(l.suggested_price) : ''} />
                {l.unit_price !== '' && String(l.unit_price) === String(l.orig_price) && l.price_source && l.price_source !== 'manual' && <div className="sub">{{ last: zh ? '上次成交價' : 'Last price', suggested: zh ? '建議售價' : 'Suggested', market: (zh ? '市場價格' : 'Market') + (d.markup ? ` +${d.markup}%` : '') }[l.price_source]}</div>}</td>
              <td><input className="input" style={{ minHeight: 34 }} inputMode="decimal" disabled={!editable} value={l.discount} onChange={(e) => setL(i, { discount: e.target.value.replace(/[^\d.]/g, '') })} aria-label={zh ? '折扣' : 'Discount'} /></td>
              <td className="num">{ntd(amount(l))}</td>
              {editable && <td><button className="btn ghost mini" onClick={() => { setLines(lines.filter((_, k) => k !== i)); setDirty(true); }} aria-label={zh ? '移除' : 'Remove'}>×</button></td>}
            </tr>))}</tbody>
        </table></div>
        {editable && <div className="row" style={{ alignItems: 'flex-start' }}><div style={{ flex: 1, minWidth: 260 }}><CodeInput zh={zh} onCodes={addCodes} placeholder={zh ? '加入酒款：輸入或掃描酒款編號、瓶號、箱號' : 'Add wines: wine, bottle or case no.'} /></div>
          <Link className="btn" to="/search">{zh ? '＋ 從搜尋加入酒款' : '+ Add from search'}</Link></div>}
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <div className="rackbox small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <b>{zh ? '內部資訊（不印在客戶版）' : 'Internal (not printed)'}</b>
            <span>{zh ? '採購成本' : 'Cost'} {ntd(cost)} · {zh ? '毛利' : 'Margin'} {ntd(margin)}{subtotal ? `（${Math.round((margin / subtotal) * 100)}%）` : ''}</span>
            {lines.some((l) => l.cost == null) && <span className="muted">{zh ? '部分酒款沒有採購價格，成本未計入。' : 'Some wines have no cost.'}</span>}
            <span className="muted">{o.status === 'draft' ? (zh ? `確認後保留 ${lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)} 瓶；出貨時掃描瓶號扣庫存並記入異動紀錄。` : 'Confirming reserves the bottles; shipping deducts them.') : o.status === 'confirmed' ? (zh ? `已保留 ${d.totals.bottles} 瓶，等待出貨。` : 'Reserved, waiting to ship.') : ''}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 16px', alignItems: 'center' }}>
            <span className="muted">{zh ? '小計' : 'Subtotal'}</span><span className="num">{ntd(subtotal)}</span>
            <span className="muted row" style={{ gap: 6 }}>{zh ? '營業稅' : 'Tax'}<input className="input" style={{ width: 64, minHeight: 30 }} disabled={!editable} value={f.tax_rate} onChange={(e) => setFf({ tax_rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label={zh ? '稅率' : 'Tax rate'} />%</span><span className="num">{ntd(tax)}</span>
            <span className="muted row" style={{ gap: 6 }}>{zh ? '運費' : 'Shipping'}<input className="input" style={{ width: 90, minHeight: 30 }} disabled={!editable} inputMode="numeric" value={f.shipping_fee} onChange={(e) => setFf({ shipping_fee: e.target.value.replace(/\D/g, '') })} aria-label={zh ? '運費' : 'Shipping'} /></span><span className="num">{ntd(Number(f.shipping_fee) || 0)}</span>
            <b>{zh ? '總金額（含稅）' : 'Total (incl. tax)'}</b><b className="num" style={{ fontSize: 20 }}>{ntd(total)}</b>
          </div>
        </div>
      </div>
      <div className="card"><h2>{zh ? '異動紀錄' : 'Change log'}</h2><LogTable rows={d.logs} /></div>
      {cancel !== null && (
        <Modal title={zh ? '取消訂單 ' + o.order_no : 'Cancel order'} onClose={() => setCancel(null)}
          footer={<><button className="btn" onClick={() => setCancel(null)}>{zh ? '返回' : 'Back'}</button><button className="btn primary" disabled={!cancel.trim()} onClick={async () => { await act('cancel', zh ? '已取消訂單' : 'Cancelled', { reason: cancel }); setCancel(null); }}>{zh ? '取消訂單' : 'Cancel order'}</button></>}>
          {o.status === 'confirmed' && <div className="alert">{zh ? `會釋放已保留的 ${d.totals.bottles} 瓶。` : 'Reserved bottles will be released.'}</div>}
          <label className="f">{zh ? '原因 *' : 'Reason *'}<input className="input" value={cancel} onChange={(e) => setCancel(e.target.value)} /></label>
        </Modal>
      )}
    </div>
  );
}
