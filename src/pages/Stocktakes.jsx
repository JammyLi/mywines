import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { run } from '../ui.jsx';

function Detail({ id, zh }) {
  const [v, setV] = useState(0);
  const { data: s } = useApi(`/api/stocktakes/${id}?v=${v}`);
  const [rack, setRack] = useState('');
  if (!s) return <div className="muted">…</div>;
  const r = s.report;
  const rackId = rack || s.racks[0]?.id;
  const moveHere = async (code, kind) => {
    const body = kind === 'case' ? { what: 'case', case_no: code, dest: { rack_id: rackId }, note: zh ? `盤點 #${id}` : `Count #${id}` } : { what: 'bottles', bottle_nos: [code], dest: { mode: 'loose', rack_id: rackId }, note: zh ? `盤點 #${id}` : `Count #${id}` };
    await run(() => api('/api/move', { method: 'POST', body }), zh ? `已把 ${code} 移到這裡` : 'Moved'); setV(v + 1);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row between"><div><h2 style={{ margin: 0, fontSize: 20 }}>{zh ? '盤點 ' : 'Count '}{r.locker}</h2><div className="muted small">{s.user_login} · {s.started_at ? new Date(s.started_at).toLocaleString('zh-TW', { hour12: false }).slice(0, -3) : s.created_at} · {zh ? `掃描 ${s.scanned.length} 項` : `${s.scanned.length} scanned`}</div></div>
        {!s.closed ? <button className="btn" onClick={async () => { await run(() => api(`/api/stocktakes/${id}/close`, { method: 'POST' }), zh ? '已結案' : 'Closed'); setV(v + 1); }}>{zh ? '處理完畢，結案' : 'Close'}</button> : <span className="tag ok">{zh ? '已結案' : 'Closed'}</span>}</div>
      <div className="grid g4">
        <div className="card kpi"><div className="l">{zh ? '應有酒箱' : 'Expected cases'}</div><div className="v">{r.expected.cases}</div></div>
        <div className="card kpi"><div className="l">{zh ? '找到' : 'Found'}</div><div className="v" style={{ color: 'var(--ok)' }}>{r.found.length}</div></div>
        <div className="card kpi"><div className="l">{zh ? '沒找到' : 'Missing'}</div><div className="v" style={{ color: r.missing.length ? 'var(--err)' : undefined }}>{r.missing.length + r.looseMissing.length}</div></div>
        <div className="card kpi"><div className="l">{zh ? '不該在這裡' : 'Elsewhere'}</div><div className="v" style={{ color: r.elsewhere.length ? 'var(--warn)' : undefined }}>{r.elsewhere.length}</div></div>
      </div>
      {(r.missing.length > 0 || r.looseMissing.length > 0) && <div className="card"><h2>{zh ? '沒找到（系統記錄在這裡，但沒掃到）' : 'Missing'}</h2>
        <div className="tbl-wrap"><table className="tbl stack"><tbody>
          {r.missing.map((c) => <tr key={c.case_no}><td><Link to={'/cases/' + encodeURIComponent(c.case_no)}>{c.case_no}</Link></td><td>{c.wines}</td><td className="num">{c.qty} {zh ? '瓶' : 'btl'}</td></tr>)}
          {r.looseMissing.map((b) => <tr key={b.bottle_no}><td><Link to={'/bottles/' + b.bottle_no}>{b.bottle_no}</Link></td><td>{b.name}</td><td className="num">{zh ? '散瓶' : 'loose'}</td></tr>)}
        </tbody></table></div>
        <div className="muted small" style={{ marginTop: 6 }}>{zh ? '可能放在別處、標籤沒掃到，或已出貨未登記。到現場找到後，在那裡掃描並移動即可。' : 'Find them on site and move them.'}</div></div>}
      {r.elsewhere.length > 0 && <div className="card"><div className="row between"><h2 style={{ margin: 0 }}>{zh ? '不該在這裡（記錄在別處）' : 'Found here, recorded elsewhere'}</h2>
        <label className="row small">{zh ? '移到架子' : 'Move to rack'}<select className="input" style={{ width: 'auto', minHeight: 32 }} value={rackId} onChange={(e) => setRack(e.target.value)}>{s.racks.map((k) => <option key={k.id} value={k.id}>{k.code}</option>)}</select></label></div>
        <div className="tbl-wrap" style={{ marginTop: 10 }}><table className="tbl stack"><tbody>
          {r.elsewhere.map((x) => <tr key={x.code}><td><Link to={(x.kind === 'case' ? '/cases/' : '/bottles/') + encodeURIComponent(x.code)}>{x.code}</Link></td><td className="muted">{zh ? '記錄在 ' : 'Recorded at '}{x.recorded}</td>
            <td>{!s.closed && <button className="btn mini" onClick={() => moveHere(x.code, x.kind)}>{zh ? '更正：移到這裡' : 'Fix: move here'}</button>}</td></tr>)}
        </tbody></table></div></div>}
      {r.unknown.length > 0 && <div className="card"><h2>{zh ? '不認得的編號' : 'Unknown codes'}</h2><div className="chips">{r.unknown.map((c) => <span className="chip" key={c}>{c}</span>)}</div></div>}
      {r.found.length > 0 && <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>{zh ? `找到的酒箱（${r.found.length}）` : `Found (${r.found.length})`}</summary>
        <div className="chips" style={{ marginTop: 10 }}>{r.found.map((c) => <span className="chip" key={c.case_no}>{c.case_no}</span>)}</div></details>}
    </div>
  );
}

export default function Stocktakes() {
  const { id } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const { data } = useApi('/api/stocktakes');
  return (
    <div className="page">
      <div className="row between"><h1>{zh ? '盤點紀錄' : 'Stock counts'}</h1><Link className="btn mobile-only" to="/m/count">{zh ? '開始盤點' : 'Start count'}</Link></div>
      <div className="muted small">{zh ? '在手機「掃描 › 盤點」掃完一個分儲空間，回公司同步後會在這裡產生差異報告。' : 'Count a locker on the phone; the difference report appears here after sync.'}</div>
      <div className="layout-search">
        <aside className={'card tree' + (id ? ' desk' : '')} style={{ padding: 10 }}>
          {data?.map((s) => <Link key={s.id} to={'/stocktakes/' + s.id} className={String(s.id) === id ? 'on' : ''} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <span>{s.locker} {s.closed ? <span className="tag ok">{zh ? '已結案' : 'Closed'}</span> : (s.missing || s.elsewhere) ? <span className="tag warn">{zh ? '有差異' : 'Diff'}</span> : <span className="tag ok">{zh ? '相符' : 'OK'}</span>}</span>
            <span className="muted small">{s.created_at.slice(0, 16)} · {s.user_login} · {zh ? `找到 ${s.found}/${s.expected}` : `${s.found}/${s.expected}`}</span></Link>)}
          {data && !data.length && <div className="muted small" style={{ padding: 10 }}>{zh ? '還沒有盤點紀錄' : 'No counts yet'}</div>}
        </aside>
        <section className="card">{id ? <><Link to="/stocktakes" className="mobile-only small">‹ {zh ? '全部' : 'All'}</Link><Detail key={id} id={id} zh={zh} /></> : <div className="muted">{zh ? '請選擇一筆盤點紀錄' : 'Pick a count'}</div>}</section>
      </div>
    </div>
  );
}
