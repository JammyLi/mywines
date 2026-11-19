import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import { CodeInput, run, toast } from '../ui.jsx';
import Scanner from '../m/Scanner.jsx';

export default function OrderShip() {
  const { no } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [scanned, setScanned] = useState([]); // { bottle_no, wine_no }
  const [useReserved, setUseReserved] = useState(false);
  const [cam, setCam] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api('/api/orders/' + no).then(setD).catch((e) => toast(e.message, 'err')); }, [no]);
  if (!d) return <div className="page muted">{t('loading')}</div>;
  if (d.order.status !== 'confirmed') return <div className="page"><div className="alert">{zh ? '這張訂單不是「已確認」，不能出貨。' : 'Only confirmed orders can ship.'}</div><Link to={'/orders/' + no}>‹ {no}</Link></div>;
  const add = async (codes) => {
    for (const code of codes) {
      try {
        const r = await api('/api/resolve/' + encodeURIComponent(code));
        const mineHeld = new Set(d.lines.flatMap((l) => l.held.map((b) => b.bottle_no)));
        // 掃整箱時，先用這張訂單保留的瓶號
        const list = (r.type === 'bottle' ? [r] : r.type === 'case' ? r.bottles : []).filter((b) => b.status !== 'reserved' || mineHeld.has(b.bottle_no))
          .sort((a, b) => (mineHeld.has(b.bottle_no) ? 1 : 0) - (mineHeld.has(a.bottle_no) ? 1 : 0));
        if (!list.length) { setMsg({ kind: 'err', text: (zh ? '請掃描瓶號或箱號：' : 'Scan a bottle or case: ') + code }); continue; }
        let added = 0;
        setScanned((cur) => {
          const next = [...cur];
          for (const b of list) {
            const line = d.lines.find((l) => l.wine_no === b.wine_no);
            if (!line) continue;
            if (next.some((x) => x.bottle_no === b.bottle_no)) continue;
            if (next.filter((x) => x.wine_no === b.wine_no).length >= line.qty) continue;
            next.push({ bottle_no: b.bottle_no, wine_no: b.wine_no }); added++;
          }
          return next;
        });
        setMsg(r.type === 'bottle' && !d.lines.some((l) => l.wine_no === r.wine_no) ? { kind: 'err', text: `${r.bottle_no} ${zh ? '不是這張訂單的酒款' : 'is not in this order'}` } : { kind: 'ok', text: `${code} ✓` });
      } catch (e) { setMsg({ kind: 'err', text: e.message }); }
    }
  };
  const need = d.lines.reduce((s, l) => s + l.qty, 0);
  const missing = need - scanned.length;
  const ship = async () => {
    try {
      await run(() => api(`/api/orders/${no}/ship`, { method: 'POST', body: { bottle_nos: scanned.map((x) => x.bottle_no), use_reserved: useReserved } }), zh ? '已出貨，庫存已扣除' : 'Shipped');
      nav('/orders/' + no);
    } catch { /* */ }
  };
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="crumbs"><Link to="/orders">{zh ? '訂單' : 'Orders'}</Link>›<Link to={'/orders/' + no}>{no}</Link>›<span>{zh ? '出貨' : 'Ship'}</span></div>
      <h1>{zh ? '出貨' : 'Ship'} {no}<span className="muted" style={{ fontSize: 16, fontWeight: 400 }}> · {d.customer?.name}</span></h1>
      <div className="muted small">{zh ? '掃描實際拿出來的瓶號（或整箱的箱號）。可以拿同款的其他瓶，系統會自動換掉保留的瓶號。' : 'Scan the bottles you actually take. Another bottle of the same wine is fine; the reservation swaps automatically.'}</div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {window.isSecureContext && <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCam(!cam)}>{cam ? (zh ? '關閉相機' : 'Close camera') : (zh ? '用相機掃描' : 'Scan with camera')}</button>}
        {cam && <Scanner zh={zh} onCode={(c) => add([c])} />}
        <CodeInput zh={zh} onCodes={add} placeholder={zh ? '掃描或輸入瓶號、箱號' : 'Scan or type bottle / case no.'} />
        {msg && <div className={'flash ' + msg.kind}>{msg.text}</div>}
      </div>
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr><th>{zh ? '酒款' : 'Wine'}</th><th>{zh ? '保留的位置' : 'Reserved at'}</th><th className="num">{zh ? '已掃 / 數量' : 'Scanned / qty'}</th><th>{zh ? '掃到的瓶號' : 'Scanned bottles'}</th></tr></thead>
        <tbody>{d.lines.map((l) => { const mine = scanned.filter((x) => x.wine_no === l.wine_no); return (
          <tr key={l.wine_no}><td><b>{l.name}</b><div className="sub">{l.vintage}</div></td>
            <td className="small">{[...new Set(l.held.map((b) => b.location + (b.case_no ? ' › ' + b.case_no : '')))].map((x) => <div key={x}>{x}</div>)}</td>
            <td className="num">{mine.length === l.qty ? <span className="tag ok">{mine.length} / {l.qty}</span> : `${mine.length} / ${l.qty}`}</td>
            <td><div className="chips">{mine.map((x) => <span className="chip" key={x.bottle_no}>{x.bottle_no}<button onClick={() => setScanned(scanned.filter((y) => y.bottle_no !== x.bottle_no))}>×</button></span>)}</div></td></tr>); })}</tbody>
      </table></div>
      <label className="check"><input type="checkbox" checked={useReserved} onChange={(e) => setUseReserved(e.target.checked)} />{zh ? `沒掃到的照保留的瓶號出貨${missing > 0 ? `（${missing} 瓶）` : ''}` : `Ship the reserved bottles for the rest${missing > 0 ? ` (${missing})` : ''}`}</label>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <span className="muted small">{zh ? '出貨後扣庫存，並記入異動紀錄' : 'Shipping deducts stock and is logged'}</span>
        <button className="btn" onClick={() => nav(-1)}>{zh ? '取消' : 'Cancel'}</button>
        <button className="btn primary" disabled={missing > 0 && !useReserved} onClick={ship}>{zh ? `確認出貨 ${need} 瓶` : `Ship ${need} bottles`}</button>
      </div>
    </div>
  );
}
