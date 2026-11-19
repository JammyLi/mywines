import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { ntd, num } from '../api.js';
import { useT } from '../i18n.jsx';

function Locker({ id }) {
  const t = useT();
  const zh = t.lang !== 'en';
  const { data, error } = useApi('/api/lockers/' + id);
  if (error) return <div className="alert err">{error.message}</div>;
  if (!data) return <div className="muted">{t('loading')}</div>;
  const { locker: l, racks, stats, caseCount } = data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row between">
        <div><div className="crumbs">{l.cellar} › {l.code}</div><h2 style={{ fontSize: 20, margin: '4px 0 0' }}>{t('locker')} {l.code}</h2></div>
        <div className="row"><Link className="btn mini" to={'/move'}>{zh ? '移動' : 'Move'}</Link></div>
        <div className="row muted">{zh ? `${caseCount} 箱 · ${num(stats.bottles)} 瓶 · 市值 ${ntd(stats.value)}` : `${caseCount} cases · ${num(stats.bottles)} bottles · ${ntd(stats.value)}`}</div>
      </div>
      {racks.map((r) => (
        <div className="rackbox" key={r.id}>
          <div className="row between"><b>{t('rack')} {r.code}</b>{r.is_default ? <span className="tag warn">{zh ? '匯入時沒有架子資料，請之後移到正確的架子' : 'No rack in import file — move later'}</span> : null}</div>
          <div className="cases">
            {r.cases.map((c) => (
              <Link to={'/cases/' + encodeURIComponent(c.case_no)} className="casecard" key={c.case_no}>
                <div className="row between"><b>{c.case_no}</b><span className="muted">{c.qty}{c.capacity ? '/' + c.capacity : ''} {zh ? '瓶' : 'btl'}</span></div>
                <span className="small">{c.wines}</span>
                <span className="muted small">{c.vintages}{c.merchants ? ' · ' + c.merchants : ''}</span>
                {c.uncertain ? <span className="tag warn" style={{ alignSelf: 'flex-start' }}>{t('uncertain')}</span> : null}
              </Link>))}
            {r.loose.map((b) => <Link to={'/bottles/' + b.bottle_no} className="casecard" key={b.bottle_no}><span className="tag">{t('loose')}</span><span className="small">{b.name} {b.vintage}</span></Link>)}
          </div>
          {!r.cases.length && !r.loose.length && <div className="muted small" style={{ marginTop: 8 }}>{zh ? '空' : 'Empty'}</div>}
        </div>))}
    </div>
  );
}

export default function Storage() {
  const { lockerId } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const go = useNavigate();
  const { data } = useApi('/api/storage');
  const first = data?.cellars.flatMap((c) => c.lockers).find((l) => l.n)?.id;
  const id = lockerId || first;
  return (
    <div className="page">
      <h1>{t('storage')}</h1>
      <div className="muted small">{zh ? '酒窖 › 分儲空間 › 架子 › 酒箱（或散瓶）' : 'Cellar › Locker › Rack › Case (or loose bottle)'}</div>
      <div className="layout-search">
        <select className="input mobile-only" value={id || ''} onChange={(e) => go('/storage/' + e.target.value)} aria-label={t('locker')}>
          {data?.cellars.map((c) => <optgroup key={c.id} label={c.name}>{c.lockers.map((l) => <option key={l.id} value={l.id}>{l.code}{l.uncertain ? ' ?' : ''} · {l.n} {zh ? '瓶' : 'btl'}</option>)}</optgroup>)}
        </select>
        <aside className="card tree desk" style={{ padding: 10 }}>
          {data?.cellars.map((c) => (
            <div key={c.id} style={{ marginBottom: 10 }}>
              <div className="row between" style={{ padding: '6px 10px' }}><b>{t('cellar')} {c.name}</b><span className="muted small">{num(c.n)}</span></div>
              {c.lockers.map((l) => (
                <Link key={l.id} to={'/storage/' + l.id} className={String(l.id) === String(id) ? 'on' : ''}>
                  <span>{l.code}{l.uncertain ? ' ?' : ''}</span><span className="muted small">{num(l.n)} {zh ? '瓶' : 'btl'}</span>
                </Link>))}
            </div>))}
        </aside>
        <section className="card">{id ? <Locker id={id} /> : <div className="muted">{zh ? '尚無儲位，請先匯入 Excel。' : 'No storage yet. Import an Excel file first.'}</div>}</section>
      </div>
    </div>
  );
}
