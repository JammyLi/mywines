import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Modal, run } from '../ui.jsx';
import { handoff } from '../handoff.js';
import { StatusModal, StockoutModal } from './dialogs.jsx';
import { useApi } from '../hooks.js';
import { ntd } from '../api.js';
import { useT } from '../i18n.jsx';
import { LogTable, Loading } from './parts.jsx';

export default function CaseDetail() {
  const { no } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [v, setV] = useState(0);
  const [sel, setSel] = useState([]);
  const [dlg, setDlg] = useState(null);
  const [form, setForm] = useState(null);
  const st = useApi('/api/cases/' + encodeURIComponent(no) + '?v=' + v);
  if (!st.data) return <Loading state={st} />;
  const { case: c, bottles, logs } = st.data;
  const inStock = bottles.filter((b) => b.status === 'in_stock');
  return (
    <div className="page">
      <div className="crumbs"><Link to="/storage">{t('storage')}</Link>›<Link to={'/storage/' + c.locker_id}>{c.cellar} › {c.locker}</Link>›<span>{c.rack}</span>›<span>{c.case_no}</span></div>
      <div className="row between">
        <div><h1>{zh ? '酒箱' : 'Case'} {c.case_no}</h1><div className="muted">{c.cellar} › {c.locker} › {c.rack}</div></div>
        <div className="row">
          <button className="btn" onClick={() => setForm({ capacity: c.capacity ?? '', note: c.note || '', kind: c.kind || '' })}>{zh ? '編輯' : 'Edit'}</button>
          <button className="btn" onClick={() => nav('/labels?k=' + handoff({ kind: 'case', case_nos: [c.case_no] }))}>{zh ? '列印箱標' : 'Case label'}</button>
          <button className="btn" onClick={() => nav('/labels?k=' + handoff({ kind: 'bottle', case_nos: [c.case_no] }))}>{zh ? '列印瓶標' : 'Bottle labels'}</button>
          <button className="btn" onClick={() => setDlg('outcase')}>{zh ? '整箱出庫' : 'Remove case'}</button>
          <button className="btn primary" onClick={() => nav('/move?case=' + encodeURIComponent(c.case_no))}>{zh ? '移動整箱' : 'Move case'}</button>
        </div>
      </div>
      {c.location_uncertain ? <div className="alert row between"><span>{zh ? '位置待確認：原始資料的位置含問號，請到現場確認。' : 'Location to confirm: the source file had a question mark.'}</span>
        <span className="row"><button className="btn mini" onClick={async () => { await run(() => api('/api/cases/' + encodeURIComponent(c.case_no), { method: 'PUT', body: { location_uncertain: false } }), zh ? '已確認位置' : 'Confirmed'); setV(v + 1); }}>{zh ? '位置正確' : 'It’s here'}</button>
          <button className="btn mini" onClick={() => nav('/move?case=' + encodeURIComponent(c.case_no))}>{zh ? '移到正確位置' : 'Move it'}</button></span></div> : null}
      <div className="grid g3">
        <div className="card kpi"><div className="l">{zh ? '在庫瓶數' : 'In stock'}</div><div className="v">{inStock.length}{c.capacity ? <span className="muted" style={{ fontSize: 16 }}> / {c.capacity}</span> : null}</div></div>
        <div className="card kpi"><div className="l">{t('market')}</div><div className="v">{ntd(inStock[0]?.price)}</div></div>
        <div className="card kpi"><div className="l">{zh ? '市值小計' : 'Value'}</div><div className="v">{ntd(inStock.reduce((s, b) => s + (b.price || 0), 0))}</div></div>
      </div>
      {c.note && <div className="card"><b>{zh ? '備註' : 'Note'}：</b>{c.note}</div>}
      <div className="card">
        <div className="row between"><h2>{zh ? '箱內酒瓶' : 'Bottles in this case'}</h2>
          <div className="row"><span className="muted small">{zh ? `已選 ${sel.length}` : `${sel.length} selected`}</span>
            <button className="btn mini" disabled={!sel.length} onClick={() => nav('/move?k=' + handoff({ what: 'bottles', bottle_nos: sel }))}>{zh ? '移出選取的酒瓶' : 'Move selected'}</button>
            <button className="btn mini" disabled={!sel.length} onClick={() => setDlg('out')}>{zh ? '出庫' : 'Remove'}</button>
            <button className="btn mini" disabled={!sel.length} onClick={() => setDlg('status')}>{zh ? '變更狀態' : 'Status'}</button></div></div>
        <div className="tbl-wrap"><table className="tbl stack">
          <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="all" style={{ width: 18, height: 18, accentColor: 'var(--wine)' }} checked={sel.length > 0 && sel.length === inStock.length} onChange={(e) => setSel(e.target.checked ? inStock.map((b) => b.bottle_no) : [])} /></th><th>{t('bottleNo')}</th><th>{t('name')}</th><th>{t('vintage')}</th><th>{t('merchant')}</th><th className="num">{t('cost')}</th><th>{t('status')}</th></tr></thead>
          <tbody>{bottles.map((b) => <tr key={b.bottle_no}><td>{b.status === 'in_stock' && <input type="checkbox" aria-label={b.bottle_no} style={{ width: 18, height: 18, accentColor: 'var(--wine)' }} checked={sel.includes(b.bottle_no)} onChange={() => setSel(sel.includes(b.bottle_no) ? sel.filter((x) => x !== b.bottle_no) : [...sel, b.bottle_no])} />}</td><td><Link to={'/bottles/' + b.bottle_no}>{b.bottle_no}</Link></td><td><Link to={'/wines/' + b.wine_no}>{b.name}</Link></td><td>{b.vintage}</td><td>{b.merchant || '—'}</td><td className="num">{ntd(b.cost)}</td><td>{t(b.status)}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="card"><h2>{t('audit')}</h2><LogTable rows={logs} /></div>
      {dlg === 'out' && <StockoutModal bottle_nos={sel} zh={zh} onClose={(n) => { setDlg(null); if (n) { setSel([]); setV(v + 1); } }} />}
      {dlg === 'outcase' && <StockoutModal case_nos={[c.case_no]} count={inStock.length} zh={zh} onClose={(n) => { setDlg(null); if (n) setV(v + 1); }} />}
      {dlg === 'status' && <StatusModal bottle_nos={sel} zh={zh} onClose={(n) => { setDlg(null); if (n) { setSel([]); setV(v + 1); } }} />}
      {form && (
        <Modal title={(zh ? '編輯酒箱 ' : 'Edit case ') + c.case_no} onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" onClick={async () => { await run(() => api('/api/cases/' + encodeURIComponent(c.case_no), { method: 'PUT', body: form }), zh ? '已儲存' : 'Saved'); setForm(null); setV(v + 1); }}>{zh ? '儲存' : 'Save'}</button></>}>
          <label className="f">{zh ? '容量（瓶）' : 'Capacity'}<input className="input" inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></label>
          <label className="f">{zh ? '類型（例：原木箱、紙箱）' : 'Kind (e.g. OWC, carton)'}<input className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} /></label>
          <label className="f">{zh ? '備註' : 'Note'}<textarea className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        </Modal>
      )}
    </div>
  );
}
