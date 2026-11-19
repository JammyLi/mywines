import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { handoff } from '../handoff.js';
import { AddToList } from './dialogs.jsx';
import { NewOrder } from './Orders.jsx';
import { useApi } from '../hooks.js';
import { ntd, num, qs } from '../api.js';
import { useT } from '../i18n.jsx';
import Icon from '../icons.jsx';

const sep = (s) => (s ? s.split(',').join(', ') : '—');

const KEYS = ['q', 'view', 'type', 'region', 'cellar', 'locker', 'rack', 'merchant', 'vmin', 'vmax', 'pmin', 'pmax', 'stale', 'uncertain', 'nocost', 'sort', 'page'];

export default function Search() {
  const t = useT();
  const zh = t.lang !== 'en';
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) || '']));
  const [kw, setKw] = useState(f.q);
  const [open, setOpen] = useState(false);
  const [addList, setAddList] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const go = useNavigate();
  useEffect(() => setKw(f.q), [f.q]);
  const set = (patch) => {
    const next = { ...f, page: '', ...patch };
    setSp(new URLSearchParams(Object.entries(next).filter(([, v]) => v)), { replace: true });
  };
  const { data: opts } = useApi('/api/filters');
  // 選項依目前其他篩選條件計算，附瓶數
  const { data: fc } = useApi('/api/facets' + qs(Object.fromEntries(KEYS.filter((k) => !['view', 'sort', 'page'].includes(k)).map((k) => [k, f[k]]))));
  const cnt = (list, key, val) => fc ? (fc[list].find((x) => String(x[key]) === String(val))?.n || 0) : null;
  const keep = (list, key, val, cur) => fc == null || cnt(list, key, val) > 0 || String(cur).split(',').includes(String(val));
  const { data, error, loading } = useApi('/api/search' + qs(f));
  const types = f.type ? f.type.split(',') : [];
  const toggleType = (c) => set({ type: (types.includes(c) ? types.filter((x) => x !== c) : [...types, c]).join(',') });
  const view = f.view === 'case' ? 'case' : 'wine';
  const query = Object.fromEntries(Object.entries(f).filter(([k, v]) => v && !['view', 'sort', 'page'].includes(k)));
  const stale = (d) => !d || (data && d < data.staleBefore);
  const pages = data ? Math.max(1, Math.ceil(data.totals.rows / data.size)) : 1;
  const nf = ['type', 'region', 'cellar', 'locker', 'rack', 'merchant', 'vmin', 'vmax', 'pmin', 'pmax', 'stale', 'uncertain', 'nocost'].filter((k) => f[k]).length;

  return (
    <div className="page">
      <div className="row between"><h1>{zh ? '庫存搜尋' : 'Search'}</h1><Link className="btn" to="/wines/new">{zh ? '＋ 新增酒款' : '+ New wine'}</Link></div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); set({ q: kw.trim() }); }} role="search">
        <input className="input" style={{ flex: 1, minWidth: 200 }} type="search" placeholder={t('keyword')} value={kw} onChange={(e) => setKw(e.target.value)} aria-label={t('search')} />
        <button className="btn primary"><Icon n="search" />{t('search')}</button>
        <button type="button" className="btn mobile-only" onClick={() => setOpen(!open)}><Icon n="filter" />{t('filters')}{nf ? ` (${nf})` : ''}</button>
      </form>
      <div className="layout-search">
        <aside className={'card filters' + (open ? '' : ' closed')} aria-label={t('filters')}>
          <div className="row between"><b>{t('filters')}</b>{nf > 0 && <button className="btn ghost" style={{ minHeight: 32, padding: '0 8px' }} onClick={() => set(Object.fromEntries(KEYS.filter((k) => !['q', 'view', 'sort'].includes(k)).map((k) => [k, ''])))}>{t('clear')}</button>}</div>
          <div className="fgroup"><b>{t('type')}</b>{opts?.types.filter((x) => keep('types', 'code', x.code, f.type)).map((x) => (
            <label className="check" key={x.code}><input type="checkbox" checked={types.includes(x.code)} onChange={() => toggleType(x.code)} /><span style={{ flex: 1 }}>{zh ? x.zh : x.en}</span>{fc && <span className="muted small">{cnt('types', 'code', x.code)}</span>}</label>
          ))}</div>
          <div className="fgroup"><b>{t('vintage')}</b><div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" inputMode="numeric" placeholder="2010" defaultValue={f.vmin} key={'a' + f.vmin} onBlur={(e) => set({ vmin: e.target.value })} aria-label="from" />–
            <input className="input" inputMode="numeric" placeholder="2020" defaultValue={f.vmax} key={'b' + f.vmax} onBlur={(e) => set({ vmax: e.target.value })} aria-label="to" /></div></div>
          <div className="fgroup"><b>{t('market')}（NT$）</b><div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" inputMode="numeric" defaultValue={f.pmin} key={'c' + f.pmin} onBlur={(e) => set({ pmin: e.target.value })} aria-label="min" />–
            <input className="input" inputMode="numeric" defaultValue={f.pmax} key={'d' + f.pmax} onBlur={(e) => set({ pmax: e.target.value })} aria-label="max" /></div></div>
          <label className="f">{t('region')}<select className="input" value={f.region} onChange={(e) => set({ region: e.target.value })}><option value="">{t('all')}</option>{opts?.regions.filter((r) => keep('regions', 'region', r, f.region)).map((r) => <option key={r} value={r}>{r}{fc ? `（${cnt('regions', 'region', r)}）` : ''}</option>)}</select></label>
          <label className="f">{zh ? '酒窖' : 'Cellar'}<select className="input" value={f.cellar} onChange={(e) => set({ cellar: e.target.value, locker: '', rack: '' })}><option value="">{t('all')}</option>{opts?.cellars.filter((c) => keep('cellars', 'id', c.id, f.cellar)).map((c) => <option key={c.id} value={c.id}>{c.name}{fc ? `（${cnt('cellars', 'id', c.id)}）` : ''}</option>)}</select></label>
          <label className="f">{t('locker')}<select className="input" value={f.locker} onChange={(e) => set({ locker: e.target.value, rack: '' })}><option value="">{t('all')}</option>{opts?.lockers.filter((l) => (!f.cellar || String(l.cellar_id) === f.cellar) && keep('lockers', 'id', l.id, f.locker)).map((l) => <option key={l.id} value={l.id}>{f.cellar ? l.code : `${l.cellar} › ${l.code}`}{fc ? `（${cnt('lockers', 'id', l.id)}）` : ''}</option>)}</select></label>
          <label className="f">{zh ? '架子' : 'Rack'}<select className="input" value={f.rack} onChange={(e) => set({ rack: e.target.value })}><option value="">{t('all')}</option>{opts?.racks.filter((k) => (!f.cellar || String(k.cellar_id) === f.cellar) && (!f.locker || String(k.locker_id) === f.locker) && keep('racks', 'id', k.id, f.rack)).map((k) => <option key={k.id} value={k.id}>{f.locker ? k.code : `${k.locker} › ${k.code}`}{fc ? `（${cnt('racks', 'id', k.id)}）` : ''}</option>)}</select></label>
          <label className="f">{t('merchant')}<select className="input" value={f.merchant} onChange={(e) => set({ merchant: e.target.value })}><option value="">{t('all')}</option>{opts?.merchants.filter((m) => keep('merchants', 'id', m.id, f.merchant)).map((m) => <option key={m.id} value={m.id}>{m.name}{fc ? `（${cnt('merchants', 'id', m.id)}）` : ''}</option>)}</select></label>
          <div className="fgroup">
            <label className="check"><input type="checkbox" checked={!!f.stale} onChange={(e) => set({ stale: e.target.checked ? '1' : '' })} />{t('stalePrices')}</label>
            <label className="check"><input type="checkbox" checked={!!f.uncertain} onChange={(e) => set({ uncertain: e.target.checked ? '1' : '' })} />{t('uncertain')}</label>
            <label className="check"><input type="checkbox" checked={!!f.nocost} onChange={(e) => set({ nocost: e.target.checked ? '1' : '' })} />{zh ? '沒有採購價格' : 'No purchase price'}</label>
          </div>
        </aside>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div className="row between">
            <div className="seg"><button className={view === 'wine' ? 'on' : ''} onClick={() => set({ view: '', sort: '' })}>{t('byWine')}</button><button className={view === 'case' ? 'on' : ''} onClick={() => set({ view: 'case', sort: '' })}>{t('byCase')}</button></div>
            {data && <div className="muted" aria-live="polite">{zh ? `${num(data.totals.wines)} 款 · ${num(data.totals.cases)} 箱 · ${num(data.totals.bottles)} 瓶 · 市值 ${ntd(data.totals.value)}` : `${num(data.totals.wines)} wines · ${num(data.totals.cases)} cases · ${num(data.totals.bottles)} bottles · ${ntd(data.totals.value)}`}</div>}
            <select className="input" style={{ width: 'auto' }} value={f.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="sort">
              {view === 'wine' ? <><option value="">{zh ? '依酒莊' : 'By winery'}</option><option value="price">{zh ? '市場價格高→低' : 'Price high→low'}</option><option value="qty">{zh ? '瓶數多→少' : 'Most bottles'}</option><option value="vintage">{t('vintage')}</option><option value="date">{zh ? '價格最舊' : 'Oldest price'}</option></>
                : <><option value="">{t('name')}</option><option value="case">{t('caseNo')}</option><option value="locker">{zh ? '位置（酒窖 › 分儲 › 架子）' : 'Location'}</option></>}
            </select>
          </div>
          {data && data.rows.length > 0 && (
            <div className="row">
              <button className="btn mini" onClick={() => setAddList(true)}>{zh ? `建立清單 / 加入清單（${num(data.totals.wines)} 款）` : `Save to list (${num(data.totals.wines)})`}</button>
              <button className="btn mini" onClick={() => go('/export?k=' + handoff({ query, title: f.q || (zh ? '搜尋結果' : 'Search results') }))}>{zh ? '匯出' : 'Export'}</button>
              <button className="btn mini" onClick={() => go('/labels?k=' + handoff({ kind: view === 'case' ? 'case' : 'bottle', query }))}>{zh ? '列印標籤' : 'Print labels'}</button>
              <button className="btn mini" onClick={() => setNewOrder(true)}>{zh ? '建立訂單' : 'New order'}</button>
              <button className="btn mini" onClick={() => go('/stockout?k=' + handoff({ query }))}>{zh ? '出庫' : 'Remove'}</button>
            </div>
          )}
          {newOrder && <NewOrder zh={zh} body={{ query }} onClose={() => setNewOrder(false)} />}
          {addList && <AddToList zh={zh} body={{ query }} defaultName={f.q} onClose={() => setAddList(false)} />}
          {error && <div className="alert err">{error.message}</div>}
          {data && !data.rows.length && <div className="card muted">{t('noResults')}</div>}
          {data && data.rows.length > 0 && (view === 'wine' ? (
            <>
              <div className="tbl-wrap desk" style={{ opacity: loading ? 0.6 : 1 }}><table className="tbl">
                <thead><tr><th>{t('winery')} / {t('name')}</th><th>{t('vintage')}</th><th>{t('type')}</th><th>{t('region')}</th><th className="num">{t('qty')}</th><th>{zh ? '酒窖' : 'Cellar'}</th><th>{t('locker')}</th><th>{zh ? '架子' : 'Rack'}</th><th className="num">{t('market')}</th><th>{t('priceDate')}</th></tr></thead>
                <tbody>{data.rows.map((r) => (
                  <tr key={r.wine_no}>
                    <td><Link to={'/wines/' + r.wine_no}>{r.name}</Link><div className="sub">{r.winery} · {r.wine_no}</div></td>
                    <td>{r.vintage}</td><td style={{ whiteSpace: 'nowrap' }}>{zh ? r.type_zh : r.type_en}</td><td>{r.region}</td>
                    <td className="num">{r.qty}<div className="sub">{r.case_count} {zh ? '箱' : 'cs'}</div></td>
                    <td>{sep(r.cellars)}</td>
                    <td>{sep(r.lockers)}{r.uncertain ? <> <span className="tag warn">?</span></> : null}</td>
                    <td>{sep(r.racks)}</td>
                    <td className="num">{ntd(r.price)}</td>
                    <td>{stale(r.price_date) ? <span className="tag warn">{r.price_date || (zh ? '無' : 'none')}</span> : r.price_date}</td>
                  </tr>))}</tbody></table></div>
              <div className="mcards">{data.rows.map((r) => (
                <Link to={'/wines/' + r.wine_no} className="wcard" key={r.wine_no}>
                  <b>{r.name}</b><span className="muted small">{r.winery} · {r.vintage} · {zh ? r.type_zh : r.type_en}</span>
                  <div className="row between"><span>{r.qty} {zh ? '瓶' : 'btl'} · {sep(r.cellars)} › {sep(r.lockers)}</span><b>{ntd(r.price)}</b></div>
                  {stale(r.price_date) && <span className="tag warn" style={{ alignSelf: 'flex-start' }}>{zh ? '價格待更新' : 'Price outdated'}</span>}
                </Link>))}</div>
            </>
          ) : (
            <>
              <div className="tbl-wrap desk" style={{ opacity: loading ? 0.6 : 1 }}><table className="tbl">
                <thead><tr><th>{t('caseNo')}</th><th>{zh ? '酒窖' : 'Cellar'}</th><th>{t('locker')}</th><th>{zh ? '架子' : 'Rack'}</th><th>{t('name')}</th><th>{t('vintage')}</th><th className="num">{t('qty')}</th><th>{t('merchant')}</th><th className="num">{t('cost')}</th><th className="num">{t('market')}</th></tr></thead>
                <tbody>{data.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.case_no === '散瓶' ? <span className="tag">{t('loose')}</span> : <Link to={'/cases/' + encodeURIComponent(r.case_no)}>{r.case_no}</Link>}</td>
                    <td>{r.cellar}</td><td>{r.locker}{r.uncertain ? <> <span className="tag warn">{t('uncertain')}</span></> : null}</td><td>{r.rack}</td>
                    <td><Link to={'/wines/' + r.wine_no}>{r.name}</Link></td><td>{r.vintage}</td><td className="num">{r.qty}</td><td>{r.merchant}</td>
                    <td className="num">{ntd(r.cost)}</td><td className="num">{ntd(r.price)}</td>
                  </tr>))}</tbody></table></div>
              <div className="mcards">{data.rows.map((r, i) => (
                <Link to={r.case_no === '散瓶' ? '/wines/' + r.wine_no : '/cases/' + encodeURIComponent(r.case_no)} className="wcard" key={i}>
                  <div className="row between"><b>{r.case_no}</b><span>{r.qty} {zh ? '瓶' : 'btl'}</span></div>
                  <span>{r.name} · {r.vintage}</span>
                  <span className="muted small">{r.cellar} › {r.locker} › {r.rack}</span>
                  {r.uncertain ? <span className="tag warn" style={{ alignSelf: 'flex-start' }}>{t('uncertain')}</span> : null}
                </Link>))}</div>
            </>
          ))}
          {data && pages > 1 && (
            <div className="pager">
              <button className="btn" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) })}>{t('prev')}</button>
              <span className="muted">{data.page} / {pages}</span>
              <button className="btn" disabled={data.page >= pages} onClick={() => set({ page: String(data.page + 1) })}>{t('next')}</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
