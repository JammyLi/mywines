import { useT } from '../i18n.jsx';

export function Changes({ json }) {
  if (!json) return null;
  let c;
  try { c = JSON.parse(json); } catch { return <span>{json}</span>; }
  return <span className="small">{Object.entries(c).map(([k, v]) => (
    <span key={k} style={{ marginRight: 10 }}><span className="muted">{k}：</span>{Array.isArray(v) ? `${v[0] ?? '—'} → ${v[1] ?? '—'}` : String(v)}</span>
  ))}</span>;
}

export function LogTable({ rows }) {
  const t = useT();
  if (!rows?.length) return <div className="muted">—</div>;
  return (
    <div className="tbl-wrap"><table className="tbl stack">
      <thead><tr><th>{t('time')}</th><th>{t('by')}</th><th>{t('action')}</th><th>{t('changes')}</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td className="muted" style={{ whiteSpace: 'nowrap' }}>{r.ts.slice(0, 16)}</td><td>{r.user_login}</td><td>{r.action}<div className="sub">{r.obj_label}</div></td><td><Changes json={r.changes} /></td></tr>)}</tbody>
    </table></div>
  );
}

export function Loading({ state }) {
  const t = useT();
  if (state.error) return <div className="page"><div className="alert err">{!state.error.status ? (t.lang === 'en' ? 'Cannot reach the office server.' : '連不到公司伺服器。') : state.error.message} {!state.error.status && <a href="/m">{t.lang === 'en' ? 'Scan (offline) ›' : '改用掃描（離線）›'}</a>}</div></div>;
  return <div className="page muted">{t('loading')}</div>;
}
