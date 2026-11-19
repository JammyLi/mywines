import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ntd, num } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { CodeInput, Modal, run } from '../ui.jsx';
import { handoff } from '../handoff.js';
import { NewOrder } from './Orders.jsx';

function ScanCreate({ zh, onClose }) {
  const nav = useNavigate();
  const [codes, setCodes] = useState([]);
  const [name, setName] = useState('');
  const go = async () => {
    const r = await run(() => api('/api/lists', { method: 'POST', body: { name, codes } }), (r) => (zh ? `已建立清單，${r.added} 款` : `Created with ${r.added} wines`));
    onClose(); nav('/lists/' + r.id);
  };
  return (
    <Modal title={zh ? '掃描建立清單' : 'Create list by scanning'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!codes.length || !name.trim()} onClick={go}>{zh ? `建立（${codes.length}）` : `Create (${codes.length})`}</button></>}>
      <label className="f">{zh ? '清單名稱' : 'List name'}<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={zh ? '例：酒窖巡查 11/18' : 'e.g. Cellar walk'} /></label>
      <CodeInput zh={zh} onCodes={(c) => setCodes([...new Set([...codes, ...c])])} placeholder={zh ? '掃描瓶標或箱標，或輸入瓶號／箱號' : 'Scan bottle or case labels'} />
      <div className="chips">{codes.map((c) => <span className="chip" key={c}>{c}<button onClick={() => setCodes(codes.filter((x) => x !== c))}>×</button></span>)}</div>
      <div className="muted small">{zh ? '同一款酒掃多瓶只會加入一次。手機相機掃描在下一階段提供；現在可用掃描槍或手動輸入。' : 'Camera scanning arrives next milestone; a barcode scanner or typing works now.'}</div>
    </Modal>
  );
}

function ListDetail({ id, zh, onChanged }) {
  const nav = useNavigate();
  const t = useT();
  const [v, setV] = useState(0);
  const { data: l, error } = useApi(`/api/lists/${id}?v=${v}`);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [sort, setSort] = useState('pos');
  const [labelDlg, setLabelDlg] = useState(false);
  const [orderDlg, setOrderDlg] = useState(false);
  useEffect(() => { if (l) { setName(l.name); setNote(l.note || ''); } }, [l]);
  if (error) return <div className="alert err">{error.message}</div>;
  if (!l) return <div className="muted">{t('loading')}</div>;
  const reload = () => { setV(v + 1); onChanged(); };
  const save = async (patch) => { await run(() => api('/api/lists/' + id, { method: 'PUT', body: patch })); reload(); };
  const items = [...l.items].sort((a, b) => (sort === 'pos' ? a.pos - b.pos : sort === 'name' ? a.name.localeCompare(b.name) : sort === 'vintage' ? String(a.vintage).localeCompare(String(b.vintage)) : sort === 'qty' ? b.qty - a.qty : (b.price || 0) - (a.price || 0)));
  const moveItem = async (i, d) => {
    const order = items.map((x) => x.wine_no);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    await save({ order });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row between">
        <div style={{ flex: 1, minWidth: 220 }}>
          <input className="input" style={{ fontSize: 20, fontWeight: 700, border: '1px solid transparent', padding: '0 6px', marginLeft: -6 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== l.name && save({ name })} aria-label={zh ? '清單名稱' : 'List name'} />
          <div className="muted small">{l.created_by} {zh ? '建立於' : 'created'} {l.created_at.slice(0, 10)} · {zh ? '品項固定，數量與價格顯示最新值' : 'Fixed items, live quantities and prices'}</div>
        </div>
      </div>
      <div className="row">
        <Link className="btn" to={'/prices/helper?list=' + id}>{zh ? '更新市場價格' : 'Update prices'}</Link>
        <Link className="btn" to={'/prices?list=' + id}>{zh ? '在列表中編輯價格' : 'Edit prices in a table'}</Link>
        <button className="btn" onClick={() => setLabelDlg(true)}>{zh ? '列印標籤' : 'Print labels'}</button>
        <Link className="btn" to={'/export?list=' + id}>{zh ? '匯出' : 'Export'}</Link>
        <button className="btn" onClick={async () => { const r = await run(() => api(`/api/lists/${id}/copy`, { method: 'POST', body: {} }), zh ? '已複製' : 'Copied'); onChanged(); nav('/lists/' + r.id); }}>{zh ? '複製' : 'Copy'}</button>
        <button className="btn" onClick={() => setOrderDlg(true)}>{zh ? '轉成訂單' : 'Make order'}</button>
        <button className="btn" onClick={() => nav('/stockout?k=' + handoff({ list: id, back: '/lists/' + id }))}>{zh ? '出庫' : 'Remove'}</button>
        <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={async () => { if (confirm(zh ? `刪除清單「${l.name}」？` : `Delete "${l.name}"?`)) { await run(() => api('/api/lists/' + id, { method: 'DELETE' }), zh ? '已刪除' : 'Deleted'); onChanged(); nav('/lists'); } }}>{zh ? '刪除' : 'Delete'}</button>
      </div>
      <label className="f">{zh ? '備註' : 'Note'}<textarea className="input" style={{ minHeight: 56 }} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (l.note || '') && save({ note })} /></label>
      <div className="row between">
        <div className="muted">{zh ? `${l.items.length} 款 · 在庫 ${num(l.bottles)} 瓶 · 平均市場價格 ${ntd(l.avgPrice)}` : `${l.items.length} wines · ${num(l.bottles)} bottles · avg ${ntd(l.avgPrice)}`}</div>
        <label className="row small">{zh ? '排序' : 'Sort'}<select className="input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="pos">{zh ? '自訂' : 'Custom'}</option><option value="name">{t('name')}</option><option value="vintage">{t('vintage')}</option><option value="qty">{zh ? '在庫' : 'In stock'}</option><option value="price">{t('market')}</option></select></label>
      </div>
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr>{sort === 'pos' && <th style={{ width: 70 }}></th>}<th>{t('name')}</th><th>{t('vintage')}</th><th className="num">{zh ? '在庫' : 'In stock'}</th><th>{t('locker')}</th><th className="num">{t('market')}</th><th></th></tr></thead>
        <tbody>{items.map((i, k) => (
          <tr key={i.wine_no}>
            {sort === 'pos' && <td><div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}><button className="btn ghost mini" disabled={k === 0} onClick={() => moveItem(k, -1)} aria-label="上移">↑</button><button className="btn ghost mini" disabled={k === items.length - 1} onClick={() => moveItem(k, 1)} aria-label="下移">↓</button></div></td>}
            <td><Link to={'/wines/' + i.wine_no}>{i.name}</Link><div className="sub">{i.winery} · {zh ? i.type_zh : i.type_en}</div></td>
            <td>{i.vintage}</td>
            <td className="num">{i.qty ? i.qty : <span className="tag warn">0</span>}</td>
            <td>{i.lockers || '—'}</td>
            <td className="num">{ntd(i.price)}{(!i.price_date || i.price_date < l.staleBefore) && <div className="sub"><span className="tag warn">{i.price_date || (zh ? '無價格' : 'none')}</span></div>}</td>
            <td><button className="btn ghost mini" onClick={async () => { await run(() => api(`/api/lists/${id}/items/${i.wine_no}`, { method: 'DELETE' })); reload(); }} aria-label={zh ? '移除' : 'Remove'}>{zh ? '移除' : 'Remove'}</button></td>
          </tr>))}</tbody>
      </table></div>
      {!l.items.length && <div className="muted">{zh ? '清單是空的。' : 'Empty list.'}</div>}
      <div className="card" style={{ background: 'var(--zebra)' }}>
        <b>{zh ? '＋ 加入酒款' : '+ Add wines'}</b>
        <div className="muted small" style={{ margin: '4px 0 8px' }}>{zh ? '輸入或掃描酒款編號、瓶號或箱號；或到「庫存搜尋」把結果加入清單。' : 'Type or scan a wine no., bottle no. or case no.; or add from Search.'}</div>
        <CodeInput zh={zh} onCodes={async (codes) => { await run(() => api(`/api/lists/${id}/items`, { method: 'POST', body: { codes } }), (r) => (zh ? `已加入 ${r.added} 款` : `Added ${r.added}`)); reload(); }} placeholder="W-000012 / B-0000331 / 04-28-22-01" />
      </div>
      {orderDlg && <NewOrder zh={zh} body={{ list_id: id }} onClose={() => setOrderDlg(false)} />}
      {labelDlg && (
        <Modal title={zh ? '列印標籤' : 'Print labels'} onClose={() => setLabelDlg(false)}>
          <button className="btn" onClick={() => nav('/labels?k=' + handoff({ kind: 'bottle', list: id, title: l.name }))}>{zh ? `酒瓶小標（${l.bottles} 張）` : `Bottle labels (${l.bottles})`}</button>
          <button className="btn" onClick={() => nav('/labels?k=' + handoff({ kind: 'case', list: id, title: l.name }))}>{zh ? '酒箱標籤' : 'Case labels'}</button>
        </Modal>
      )}
    </div>
  );
}

export default function Lists() {
  const { id } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const [v, setV] = useState(0);
  const { data: lists } = useApi('/api/lists?v=' + v);
  const [scan, setScan] = useState(false);
  const nav = useNavigate();
  useEffect(() => { if (!id && lists?.length && window.innerWidth > 900) nav('/lists/' + lists[0].id, { replace: true }); }, [id, lists, nav]);
  return (
    <div className="page">
      <div className="row between">
        <h1>{zh ? '我的清單' : 'My lists'}</h1>
        <div className="row"><button className="btn" onClick={() => setScan(true)}>{zh ? '用手機掃描建立' : 'Create by scanning'}</button><Link className="btn primary" to="/search">{zh ? '＋ 從搜尋建立清單' : '+ From search'}</Link></div>
      </div>
      <div className="layout-search">
        <aside className={'card tree' + (id ? ' desk' : '')} style={{ padding: 10 }}>
          {lists?.map((l) => (
            <Link key={l.id} to={'/lists/' + l.id} className={String(l.id) === id ? 'on' : ''} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px' }}>
              <span>{l.name}</span><span className="muted small">{l.wines} {zh ? '款' : 'wines'} · {l.bottles} {zh ? '瓶' : 'btl'} · {l.created_by}</span>
            </Link>))}
          {lists && !lists.length && <div className="muted small" style={{ padding: 10 }}>{zh ? '還沒有清單。到「庫存搜尋」篩選後按「建立清單」。' : 'No lists yet. Create one from Search.'}</div>}
        </aside>
        <section className="card">{id ? <><Link to="/lists" className="mobile-only small">‹ {zh ? '所有清單' : 'All lists'}</Link><ListDetail key={id} id={id} zh={zh} onChanged={() => setV(v + 1)} /></> : <div className="muted">{zh ? '請選擇一個清單' : 'Pick a list'}</div>}</section>
      </div>
      {scan && <ScanCreate zh={zh} onClose={() => { setScan(false); setV(v + 1); }} />}
    </div>
  );
}
