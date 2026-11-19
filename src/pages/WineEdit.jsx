import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { RackPicker, run, toast } from '../ui.jsx';
import { handoff } from '../handoff.js';
import { Loading } from './parts.jsx';

const VOLUMES = [[375, '375 ml（Half）'], [750, '750 ml（Bottle）'], [1500, '1.5 L（Magnum）'], [3000, '3 L（Jeroboam）']];
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function StockFields({ s, set, zh, opts }) {
  const [caseInfo, setCaseInfo] = useState(null);
  useEffect(() => {
    if (s.dest.mode !== 'case' || !s.dest.case_no) { setCaseInfo(null); return; }
    const t = setTimeout(() => api('/api/cases/' + encodeURIComponent(s.dest.case_no)).then(setCaseInfo).catch(() => setCaseInfo(false)), 300);
    return () => clearTimeout(t);
  }, [s.dest.mode, s.dest.case_no]);
  const d = s.dest;
  const setD = (p) => set({ ...s, dest: { ...d, ...p } });
  const modes = [['newcase', zh ? '放入新酒箱' : 'New case'], ['case', zh ? '放入現有酒箱' : 'Existing case'], ['loose', zh ? '散瓶放架子上' : 'Loose on rack']];
  return (
    <>
      <div className="radio-cards" role="radiogroup">{modes.map(([m, l]) => (
        <label key={m} className={d.mode === m ? 'on' : ''}><input type="radio" name="destmode" checked={d.mode === m} onChange={() => setD({ mode: m })} />{l}</label>
      ))}</div>
      {d.mode === 'case' ? (
        <label className="f">{zh ? '箱號' : 'Case no.'}<input className="input" value={d.case_no || ''} onChange={(e) => setD({ case_no: e.target.value.trim() })} placeholder="12-06-23-07" />
          {caseInfo && <span className="muted small">{caseInfo.case.cellar} › {caseInfo.case.locker} › {caseInfo.case.rack} · {caseInfo.bottles.filter((b) => b.status === 'in_stock').length}{caseInfo.case.capacity ? ' / ' + caseInfo.case.capacity : ''} {zh ? '瓶' : 'btl'}</span>}
          {caseInfo === false && <span className="small" style={{ color: 'var(--err)' }}>{zh ? '找不到這個箱號' : 'Case not found'}</span>}
        </label>
      ) : (
        <>
          <RackPicker value={d.rack_id} onChange={(v) => setD({ rack_id: v })} zh={zh} />
          {d.mode === 'newcase' && (
            <div className="grid g2" style={{ gap: 10 }}>
              <label className="f">{zh ? '箱號（留空自動編號）' : 'Case no. (blank = automatic)'}<input className="input" value={d.case_no || ''} onChange={(e) => setD({ case_no: e.target.value.trim() })} /></label>
              <label className="f">{zh ? '酒箱容量（瓶）' : 'Case capacity'}<input className="input" inputMode="numeric" value={d.capacity ?? 6} onChange={(e) => setD({ capacity: e.target.value })} /></label>
            </div>
          )}
        </>
      )}
      <div className="grid g4" style={{ gap: 10 }}>
        <label className="f">{zh ? '瓶數 *' : 'Bottles *'}<input className="input" inputMode="numeric" value={s.qty} onChange={(e) => set({ ...s, qty: e.target.value.replace(/\D/g, '') })} required /></label>
        <label className="f">{zh ? '酒商' : 'Merchant'}<input className="input" list="merchants" value={s.merchant} onChange={(e) => set({ ...s, merchant: e.target.value })} />
          <datalist id="merchants">{opts?.merchants.map((m) => <option key={m.id} value={m.name} />)}</datalist></label>
        <label className="f">{zh ? '採購價格（NT$ / 瓶）' : 'Purchase price (NT$)'}<input className="input" inputMode="numeric" value={s.cost} onChange={(e) => set({ ...s, cost: e.target.value })} /></label>
        <label className="f">{zh ? '採購日期' : 'Purchase date'}<input className="input" type="date" value={s.date} onChange={(e) => set({ ...s, date: e.target.value })} /></label>
      </div>
    </>
  );
}

export const emptyStock = () => ({ qty: '', merchant: '', cost: '', date: today(), dest: { mode: 'newcase', capacity: 6 } });

export default function WineEdit({ mode }) {
  const { no } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const { data: opts } = useApi('/api/filters');
  const existing = useApi(no ? '/api/wines/' + encodeURIComponent(no) : '/api/me');
  const [w, setW] = useState({ country: '', region: '', winery: '', name: '', vintage: '', type_code: '', volume_ml: 750, suggested_price: '', grapes: '', classification: '', notes: '' });
  const [nv, setNv] = useState(false);
  const [stock, setStock] = useState(emptyStock());
  const [price, setPrice] = useState({ price: '', date: today(), source: '' });
  const [similar, setSimilar] = useState([]);
  const [busy, setBusy] = useState(false);
  const isNew = mode === 'new', isStock = mode === 'stock', isEdit = mode === 'edit';
  useEffect(() => {
    if (!no || !existing.data?.wine) return;
    const x = existing.data.wine;
    setW(Object.fromEntries(Object.keys(w).map((k) => [k, x[k] ?? ''])));
    setNv(x.vintage === 'NV');
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isNew || !w.winery || !w.name) { setSimilar([]); return; }
    const tm = setTimeout(() => api(`/api/wines-similar?winery=${encodeURIComponent(w.winery)}&name=${encodeURIComponent(w.name)}&vintage=${nv ? 'NV' : w.vintage}&volume=${w.volume_ml}`).then(setSimilar).catch(() => {}), 400);
    return () => clearTimeout(tm);
  }, [isNew, w.winery, w.name, w.vintage, w.volume_ml, nv]);
  if (no && !existing.data?.wine) return <Loading state={existing} />;
  const f = (k) => ({ value: w[k] ?? '', onChange: (e) => setW({ ...w, [k]: e.target.value }) });
  const wine = existing.data?.wine;

  const save = async (andPrint) => {
    setBusy(true);
    try {
      const body = { ...w, vintage: nv ? 'NV' : w.vintage };
      let r, target = no;
      if (isNew) {
        r = await run(() => api('/api/wines', { method: 'POST', body: { wine: body, stock: stock.qty ? stock : null, price: price.price ? price : null } }));
        target = r.wine_no;
      } else if (isEdit) {
        r = await run(() => api('/api/wines/' + no, { method: 'PUT', body }));
        toast(r.changed ? (zh ? `已儲存 ${r.changed} 項修改` : `Saved ${r.changed} changes`) : (zh ? '沒有修改' : 'No changes'));
      } else {
        r = await run(() => api(`/api/wines/${no}/stock`, { method: 'POST', body: stock }));
      }
      if (r.bottle_nos) toast(zh ? `已入庫 ${r.bottle_nos.length} 瓶：${r.bottle_nos[0]} – ${r.bottle_nos.at(-1)}` : `Added ${r.bottle_nos.length} bottles`);
      if (r.warning) toast(r.warning, 'err');
      if (andPrint && r.bottle_nos) nav('/labels?k=' + handoff({ kind: 'bottle', bottle_nos: r.bottle_nos }));
      else nav('/wines/' + target);
    } catch { /* toast 已顯示 */ } finally { setBusy(false); }
  };
  const stockOk = !stock.qty || (stock.dest.mode === 'case' ? !!stock.dest.case_no : !!stock.dest.rack_id);
  const wineOk = !!(w.winery && w.name && w.type_code && (nv || /^\d{4}$/.test(w.vintage)));
  const canSave = isStock ? Number(stock.qty) > 0 && stockOk : isEdit ? wineOk : wineOk && stockOk;
  const title = isNew ? (zh ? '新增酒款' : 'New wine') : isEdit ? (zh ? '編輯酒款' : 'Edit wine') : (zh ? '加入庫存' : 'Add stock');
  const qty = Number(stock.qty) || 0;

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="crumbs"><Link to="/search">{zh ? '庫存搜尋' : 'Search'}</Link>›{wine && <><Link to={'/wines/' + wine.wine_no}>{wine.wine_no}</Link>›</>}<span>{title}</span></div>
      <h1>{title}{wine ? <span className="muted" style={{ fontSize: 16, fontWeight: 400 }}> · {wine.name} {wine.vintage}</span> : null}</h1>
      {similar.length > 0 && (
        <div className="alert"><b>{zh ? '找到相同酒款' : 'This wine already exists'}</b>：{similar[0].name} · {similar[0].vintage} · {similar[0].volume_ml} ml（{zh ? '目前' : 'now'} {similar[0].qty} {zh ? '瓶' : 'btl'}）
          <div style={{ marginTop: 6 }}><Link className="btn mini" to={`/wines/${similar[0].wine_no}/stock`}>{zh ? '改為加入這款酒的庫存' : 'Add stock to this wine instead'}</Link></div></div>
      )}
      {!isStock && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>{zh ? '基本資料' : 'Basics'}</h2>
          <div className="grid g2" style={{ gap: 12 }}>
            <label className="f">{zh ? '國家' : 'Country'}<input className="input" list="countries" {...f('country')} /><datalist id="countries">{opts?.countries.map((x) => <option key={x} value={x} />)}</datalist></label>
            <label className="f">{zh ? '產區' : 'Region'}<input className="input" list="regions" {...f('region')} /><datalist id="regions">{opts?.regions.map((x) => <option key={x} value={x} />)}</datalist></label>
            <label className="f">{zh ? '酒莊 *' : 'Winery *'}<input className="input" list="wineries" {...f('winery')} required /><datalist id="wineries">{opts?.wineries.map((x) => <option key={x} value={x} />)}</datalist></label>
            <label className="f">{zh ? '品名 *' : 'Name *'}<input className="input" {...f('name')} required /></label>
            <label className="f">{zh ? '年份 *' : 'Vintage *'}<div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" inputMode="numeric" maxLength={4} {...f('vintage')} disabled={nv} placeholder="2015" />
              <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={nv} onChange={(e) => setNv(e.target.checked)} />NV {zh ? '無年份' : 'Non-vintage'}</label></div></label>
            <label className="f">{zh ? '種類 *' : 'Type *'}<select className="input" {...f('type_code')} required><option value="">—</option>{opts?.types.map((x) => <option key={x.code} value={x.code}>{x.zh} {x.en}</option>)}</select></label>
            <label className="f">{zh ? '容量 *' : 'Volume *'}<select className="input" value={w.volume_ml} onChange={(e) => setW({ ...w, volume_ml: Number(e.target.value) })}>
              {[...VOLUMES, ...(VOLUMES.some((v) => v[0] === Number(w.volume_ml)) ? [] : [[Number(w.volume_ml), w.volume_ml + ' ml']])].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="f">{zh ? '建議售價（NT$）' : 'Suggested price (NT$)'}<input className="input" inputMode="numeric" {...f('suggested_price')} /></label>
          </div>
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>{zh ? '選填資訊（葡萄品種、分級、備註）' : 'Optional: grapes, classification, notes'}</summary>
            <div className="grid g2" style={{ gap: 12, marginTop: 12 }}>
              <label className="f">{zh ? '葡萄品種' : 'Grapes'}<input className="input" {...f('grapes')} placeholder="Pinot Noir, Chardonnay" /></label>
              <label className="f">{zh ? '分級' : 'Classification'}<input className="input" {...f('classification')} placeholder="Grand Cru" /></label>
            </div>
            <label className="f" style={{ marginTop: 12 }}>{zh ? '備註 / 品飲筆記' : 'Notes'}<textarea className="input" {...f('notes')} /></label>
          </details>
        </div>
      )}
      {(isNew || isStock) && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>{zh ? '入庫' : 'Stock in'}{isNew && <span className="muted small" style={{ fontWeight: 400 }}> · {zh ? '選填，可以之後再加' : 'optional'}</span>}</h2>
          <StockFields s={stock} set={setStock} zh={zh} opts={opts} />
        </div>
      )}
      {isNew && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>{zh ? '市場價格' : 'Market price'}<span className="muted small" style={{ fontWeight: 400 }}> · {zh ? '選填' : 'optional'}</span></h2>
          <div className="grid g3" style={{ gap: 10 }}>
            <label className="f">{zh ? '市場價格（NT$ / 瓶）' : 'Market price (NT$)'}<input className="input" inputMode="numeric" value={price.price} onChange={(e) => setPrice({ ...price, price: e.target.value })} /></label>
            <label className="f">{zh ? '查價日期' : 'Date'}<input className="input" type="date" value={price.date} onChange={(e) => setPrice({ ...price, date: e.target.value })} /></label>
            <label className="f">{zh ? '來源' : 'Source'}<input className="input" value={price.source} onChange={(e) => setPrice({ ...price, source: e.target.value })} placeholder="Wine-Searcher" /></label>
          </div>
        </div>
      )}
      {qty > 0 && <div className="muted">{zh ? `儲存後會產生 ${qty} 個瓶號，並記入異動紀錄。` : `Saving creates ${qty} bottle numbers and a change log entry.`}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => nav(-1)} disabled={busy}>{zh ? '取消' : 'Cancel'}</button>
        {(isNew || isStock) && qty > 0 && <button className="btn" onClick={() => save(true)} disabled={busy || !canSave}>{zh ? `儲存並列印 ${qty} 張瓶標` : `Save & print ${qty} labels`}</button>}
        <button className="btn primary" onClick={() => save(false)} disabled={busy || !canSave}>{zh ? '儲存' : 'Save'}</button>
      </div>
    </div>
  );
}
