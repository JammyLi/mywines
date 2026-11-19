import { Link } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { ntd, num } from '../api.js';
import { useT } from '../i18n.jsx';

export default function Dashboard() {
  const t = useT();
  const zh = t.lang !== 'en';
  const { data: d, error } = useApi('/api/dashboard');
  if (error) return <div className="page"><div className="alert err">{!error.status ? (zh ? '連不到公司伺服器。在酒窖可以改用「掃描」。' : 'Cannot reach the office server. Use Scan while offline.') : error.message} {!error.status && <a href="/m">{zh ? '前往掃描 ›' : 'Go to scan ›'}</a>}</div></div>;
  if (!d) return <div className="page muted">{t('loading')}</div>;
  const maxT = Math.max(1, ...d.byType.map((x) => x.n));
  const maxL = Math.max(1, ...d.byLocker.map((x) => x.n));
  return (
    <div className="page">
      <h1>{t('dashboard')}</h1>
      <div className="grid g4">
        <Link to="/search" className="card kpi" style={{ color: 'inherit' }}><div className="l">{t('totalBottles')}</div><div className="v">{num(d.bottles)}</div><div className="muted small">{num(d.wines)} {zh ? '款' : 'wines'}</div></Link>
        <Link to="/search?view=case" className="card kpi" style={{ color: 'inherit' }}><div className="l">{t('totalCases')}</div><div className="v">{num(d.cases)}</div><div className="muted small">{num(d.lockers)} {zh ? '個分儲空間' : 'lockers'}</div></Link>
        <div className="card kpi"><div className="l">{t('totalValue')}</div><div className="v">{ntd(d.value)}</div><div className="muted small">{zh ? '依各酒款最新市場價格' : 'Latest market price per wine'}</div></div>
        <Link to="/search?stale=1" className="card kpi" style={{ color: 'inherit' }}><div className="l">{t('stalePrices')}</div><div className="v" style={{ color: d.stale ? 'var(--warn)' : undefined }}>{num(d.stale)}</div><div className="muted small">{zh ? '款' : 'wines'}</div></Link>
      </div>
      <div className="grid g3">
        <div className="card">
          <h2>{t('byType')}</h2>
          <div className="bars">{d.byType.map((x) => (
            <div className="bar" key={x.label}><span>{x.label}{!x.mapped && <span className="tag warn" style={{ marginLeft: 4 }}>!</span>}</span><span className="track"><span className="fill" style={{ width: (x.n / maxT) * 100 + '%', display: 'block' }} /></span><span className="num">{num(x.n)}</span></div>
          ))}</div>
        </div>
        <div className="card">
          <h2>{t('byLocker')}</h2>
          <div className="bars">{d.byLocker.map((x) => (
            <Link to={'/storage/' + x.id} className="bar" key={x.id} style={{ color: 'inherit' }}><span>{x.cellar} › {x.code}</span><span className="track"><span className="fill" style={{ width: (x.n / maxL) * 100 + '%', display: 'block' }} /></span><span className="num">{num(x.n)}</span></Link>
          ))}</div>
        </div>
        <div className="card">
          <h2>{t('todo')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.uncertain > 0 && <Link to="/search?view=case&uncertain=1" className="alert">{zh ? `${d.uncertain} 箱位置待確認` : `${d.uncertain} cases need location check`}</Link>}
            {d.unmapped.filter((u) => u.n).map((u) => <div className="alert" key={u.code}>{zh ? `種類代碼「${u.code}」待對應（${u.n} 瓶）` : `Type code "${u.code}" not mapped (${u.n} bottles)`}</div>)}
            {d.openOrders > 0 && <Link to="/orders?status=confirmed" className="alert" style={{ background: 'var(--wine-soft)', color: 'var(--wine)' }}>{zh ? `${d.openOrders} 張訂單未出貨（保留 ${d.reserved} 瓶）` : `${d.openOrders} open orders (${d.reserved} reserved)`}</Link>}
            {d.stale > 0 && <Link to="/search?stale=1" className="alert">{zh ? `${d.stale} 款市場價格超過 30 天` : `${d.stale} wines have prices older than 30 days`}</Link>}
            {!d.uncertain && !d.stale && !d.openOrders && !d.unmapped.some((u) => u.n) && <div className="alert ok">{zh ? '目前沒有待處理事項' : 'Nothing to do'}</div>}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="row between"><h2>{t('recent')}</h2><Link to="/audit">{t('more')} ›</Link></div>
        <div className="tbl-wrap"><table className="tbl"><tbody>
          {d.recent.map((r, i) => <tr key={i}><td className="muted" style={{ whiteSpace: 'nowrap' }}>{r.ts.slice(5, 16)}</td><td>{r.user_login}</td><td><span className="tag">{r.category}</span></td><td>{r.action}</td><td>{r.obj_label}</td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  );
}
