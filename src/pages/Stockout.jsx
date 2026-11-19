import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import { CodeInput, run, toast } from '../ui.jsx';
import { receive } from '../handoff.js';
import { ReasonPicker } from './dialogs.jsx';

// 批次出庫：從酒款、搜尋結果或清單帶入，填每款要出庫的瓶數；也可以掃描指定瓶號／箱號
export default function Stockout() {
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const src = useMemo(() => receive(sp.get('k')) || {}, [sp]);
  const [wines, setWines] = useState(null);
  const [qty, setQty] = useState({});
  const [codes, setCodes] = useState(src.bottle_nos || []);
  const [cases, setCases] = useState(src.case_nos || []);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const body = src.list ? { list: src.list } : src.query ? { query: src.query } : { wine_nos: src.wine_nos || [] };
    api('/api/stockout/candidates', { method: 'POST', body }).then((w) => { setWines(w); if (w.length === 1 && !codes.length && !cases.length) setQty({ [w[0].wine_no]: '' }); }).catch((e) => toast(e.message, 'err'));
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  const addCodes = async (list) => {
    for (const c of list) {
      try {
        const r = await api('/api/resolve/' + encodeURIComponent(c));
        if (r.type === 'case') setCases((x) => [...new Set([...x, r.case_no])]);
        else if (r.type === 'bottle') { if (r.status !== 'in_stock') toast(`${r.bottle_no} ${zh ? '不在庫' : 'not in stock'}`, 'err'); else setCodes((x) => [...new Set([...x, r.bottle_no])]); }
        else toast(zh ? `「${c}」不是瓶號或箱號` : `"${c}" is not a bottle or case`, 'err');
      } catch (e) { toast(e.message, 'err'); }
    }
  };
  const picks = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([wine_no, v]) => ({ wine_no, qty: Number(v) }));
  const total = picks.reduce((s, p) => s + p.qty, 0) + codes.length;
  const ready = reason && (reason !== 'other' || note.trim()) && (total > 0 || cases.length);
  const go = async () => {
    setBusy(true);
    try { const r = await run(() => api('/api/stockout', { method: 'POST', body: { picks, bottle_nos: codes, case_nos: cases, reason, note } }), (r) => (zh ? `已出庫 ${r.count} 瓶` : `${r.count} bottles removed`)); nav(src.back || (src.wine_nos?.length === 1 ? '/wines/' + src.wine_nos[0] : '/search')); }
    catch { /* */ } finally { setBusy(false); }
  };
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="crumbs"><Link to="/search">{zh ? '庫存搜尋' : 'Search'}</Link>›<span>{zh ? '出庫' : 'Remove from stock'}</span></div>
      <h1>{zh ? '出庫' : 'Remove from stock'}</h1>
      <div className="muted small">{zh ? '不經過訂單把酒移出庫存（自用、贈送、試飲、破損…）。系統會先用散瓶和瓶數少的酒箱；要指定哪幾瓶，請在下方掃描瓶號或箱號。賣給客戶請用訂單。' : 'Take bottles out of stock without an order. Loose bottles and partial cases go first; scan below to choose exact bottles.'}</div>
      {wines?.length > 0 && (
        <div className="tbl-wrap"><table className="tbl stack">
          <thead><tr><th>{t('name')}</th><th>{t('vintage')}</th><th className="num">{zh ? '在庫' : 'In stock'}</th><th style={{ width: 120 }}>{zh ? '出庫瓶數' : 'Remove'}</th></tr></thead>
          <tbody>{wines.map((w) => <tr key={w.wine_no}><td><Link to={'/wines/' + w.wine_no}>{w.name}</Link><div className="sub">{w.winery}</div></td><td>{w.vintage}</td>
            <td className="num">{w.available}{w.reserved ? <div className="sub">{zh ? `另有 ${w.reserved} 瓶被訂單保留` : `${w.reserved} reserved`}</div> : null}</td>
            <td><input className="input" style={{ minHeight: 34 }} inputMode="numeric" value={qty[w.wine_no] ?? ''} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setQty({ ...qty, [w.wine_no]: v && Number(v) > w.available ? String(w.available) : v }); }} aria-label={w.name} placeholder="0" /></td></tr>)}</tbody>
        </table></div>)}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <b>{zh ? '指定瓶號或整箱（選填）' : 'Specific bottles or whole cases (optional)'}</b>
        <CodeInput zh={zh} onCodes={addCodes} placeholder={zh ? '掃描或輸入瓶號、箱號' : 'Scan or type bottle / case no.'} />
        {(codes.length > 0 || cases.length > 0) && <div className="chips">
          {cases.map((c) => <span className="chip" key={c}>{zh ? '整箱 ' : 'Case '}{c}<button onClick={() => setCases(cases.filter((x) => x !== c))}>×</button></span>)}
          {codes.map((c) => <span className="chip" key={c}>{c}<button onClick={() => setCodes(codes.filter((x) => x !== c))}>×</button></span>)}</div>}
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <b>{zh ? '出庫原因' : 'Reason'}</b>
        <ReasonPicker reason={reason} setReason={setReason} note={note} setNote={setNote} zh={zh} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <span className="muted small">{zh ? '出庫後不再算庫存，紀錄保留並記入異動紀錄' : 'Logged; records are kept'}</span>
        <button className="btn" onClick={() => nav(-1)}>{zh ? '取消' : 'Cancel'}</button>
        <button className="btn primary" disabled={!ready || busy} onClick={go}>{zh ? `確認出庫${total ? ` ${total} 瓶` : ''}${cases.length ? ` ＋ ${cases.length} 箱` : ''}` : 'Remove'}</button>
      </div>
    </div>
  );
}
