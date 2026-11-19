import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { num, qs } from '../api.js';
import { useT } from '../i18n.jsx';
import { Changes } from './parts.jsx';

const CATS = ['酒款', '庫存', '價格', '清單', '匯入', '匯出', '設定', '銷售'];
const link = (r) => (!r.obj_id ? null : r.obj_type === 'wine' ? '/wines/' + r.obj_id : r.obj_type === 'case' ? '/cases/' + encodeURIComponent(r.obj_id) : r.obj_type === 'bottle' ? '/bottles/' + r.obj_id : r.obj_type === 'list' ? '/lists/' + r.obj_id : null);

export default function AuditLog() {
  const t = useT();
  const zh = t.lang !== 'en';
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(['user', 'from', 'to', 'cat', 'q', 'page'].map((k) => [k, sp.get(k) || '']));
  const [kw, setKw] = useState(f.q);
  const set = (p) => setSp(new URLSearchParams(Object.entries({ ...f, page: '', ...p }).filter(([, v]) => v)), { replace: true });
  const { data, error } = useApi('/api/audit' + qs(f));
  const cats = f.cat ? f.cat.split(',') : [];
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;
  return (
    <div className="page">
      <h1>{t('audit')}</h1>
      <div className="muted small">{zh ? '紀錄只能新增，不能修改或刪除。密碼不會出現在紀錄中。' : 'Entries can only be added, never edited or deleted. Passwords are never logged.'}</div>
      <div className="card row" style={{ alignItems: 'flex-end' }}>
        <label className="f" style={{ minWidth: 140 }}>{t('by')}<select className="input" value={f.user} onChange={(e) => set({ user: e.target.value })}><option value="">{t('all')}</option>{data?.users.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="f">{zh ? '從' : 'From'}<input className="input" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="f">{zh ? '到' : 'To'}<input className="input" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <form className="f" style={{ flex: 1, minWidth: 180 }} onSubmit={(e) => { e.preventDefault(); set({ q: kw }); }}>{zh ? '對象（酒款、箱號、瓶號）' : 'Object'}<input className="input" type="search" value={kw} onChange={(e) => setKw(e.target.value)} onBlur={() => kw !== f.q && set({ q: kw })} /></form>
        <div className="row" style={{ width: '100%' }}>{CATS.map((c) => (
          <label className="check" key={c} style={{ marginRight: 8 }}><input type="checkbox" checked={cats.includes(c)} onChange={() => set({ cat: (cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]).join(',') })} />{c}</label>
        ))}</div>
      </div>
      {error && <div className="alert err">{error.message}</div>}
      {data && <div className="muted">{zh ? `共 ${num(data.total)} 筆` : `${num(data.total)} entries`}</div>}
      {data && (
        <div className="tbl-wrap"><table className="tbl stack">
          <thead><tr><th>{t('time')}</th><th>{t('by')}</th><th>{t('category')}</th><th>{t('action')}</th><th>{t('object')}</th><th>{t('changes')}</th></tr></thead>
          <tbody>{data.rows.map((r) => {
            const to = link(r);
            return (
              <tr key={r.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{r.ts}</td><td>{r.user_login}</td><td><span className="tag">{r.category}</span></td><td>{r.action}</td>
                <td>{to ? <Link to={to}>{r.obj_id}</Link> : r.obj_id}<div className="sub">{r.obj_label}</div>{r.batch_id && r.obj_type !== 'import' ? <div className="sub">{r.batch_id}</div> : null}</td>
                <td><Changes json={r.changes} />{r.reason && <div className="sub">{zh ? '原因' : 'Reason'}：{r.reason}</div>}</td>
              </tr>);
          })}</tbody>
        </table></div>)}
      {data && pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) })}>{t('prev')}</button>
          <span className="muted">{data.page} / {pages}</span>
          <button className="btn" disabled={data.page >= pages} onClick={() => set({ page: String(data.page + 1) })}>{t('next')}</button>
        </div>)}
    </div>
  );
}
