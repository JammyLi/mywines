import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { api, ntd, num } from '../api.js';
import { useT } from '../i18n.jsx';
import { Modal, run } from '../ui.jsx';
import { handoff } from '../handoff.js';
import { LogTable, Loading } from './parts.jsx';
import { AddToList, StatusModal, StockoutModal } from './dialogs.jsx';

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function WineDetail() {
  const { no } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [v, setV] = useState(0);
  const st = useApi('/api/wines/' + encodeURIComponent(no) + '?v=' + v);
  const photos = useApi(`/api/wines/${encodeURIComponent(no)}/photos?v=${v}`);
  const sales = useApi(`/api/wines/${encodeURIComponent(no)}/sales?v=${v}`);
  const [dlg, setDlg] = useState(null);
  const [sel, setSel] = useState([]);
  const [pf, setPf] = useState({ price: '', date: today(), source: '' });
  const [voidId, setVoidId] = useState(null);
  const [reason, setReason] = useState('');
  const fileRef = useRef();
  if (!st.data) return <Loading state={st} />;
  const reload = () => setV(v + 1);
  const { wine: w, locations, bottles, prices, logs, qty, avgCost, costQty, price } = st.data;
  const active = prices.filter((p) => !p.voided);
  const maxP = Math.max(1, ...active.map((p) => p.price));
  const inStock = bottles.filter((b) => b.status === 'in_stock');
  const toggle = (b) => setSel(sel.includes(b) ? sel.filter((x) => x !== b) : [...sel, b]);
  const savePrice = async () => { await run(() => api(`/api/wines/${no}/prices`, { method: 'POST', body: pf }), zh ? '已更新市場價格' : 'Price updated'); setDlg(null); setPf({ price: '', date: today(), source: '' }); reload(); };
  const doVoid = async () => { await run(() => api(`/api/prices/${voidId}/void`, { method: 'POST', body: { reason } }), zh ? '已作廢' : 'Voided'); setVoidId(null); setReason(''); reload(); };
  const upload = async (files) => {
    if (!files?.length) return;
    const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
    await run(() => api(`/api/wines/${no}/photos`, { method: 'POST', body: fd }), zh ? '已上傳照片' : 'Uploaded');
    reload();
  };
  return (
    <div className="page">
      <div className="crumbs"><Link to="/search">{zh ? '庫存搜尋' : 'Search'}</Link>›<span>{w.wine_no}</span></div>
      <div className="row between">
        <div><h1>{w.name}</h1><div className="muted">{w.winery} · {w.vintage} · {zh ? w.type_zh : w.type_en}</div></div>
        <div className="row">
          <Link className="btn" to={`/wines/${no}/edit`}>{zh ? '編輯' : 'Edit'}</Link>
          <Link className="btn" to={`/wines/${no}/stock`}>{zh ? '加入庫存' : 'Add stock'}</Link>
          <button className="btn" onClick={() => setDlg('list')}>{zh ? '加入清單' : 'Add to list'}</button>
          <button className="btn" onClick={() => nav('/stockout?k=' + handoff({ wine_nos: [w.wine_no] }))}>{zh ? '出庫' : 'Remove'}</button>
          <button className="btn primary" onClick={() => setDlg('price')}>{zh ? '更新市場價格' : 'Update price'}</button>
        </div>
      </div>
      <div className="grid g4">
        <div className="card kpi"><div className="l">{t('totalBottles')}</div><div className="v">{num(qty)}</div></div>
        <div className="card kpi"><div className="l">{t('market')}</div><div className="v">{ntd(price?.price)}</div><div className="muted small">{price ? `${price.effective_date} · ${price.source || ''}` : '—'}</div></div>
        <div className="card kpi"><div className="l">{t('avgCost')}</div><div className="v">{ntd(avgCost)}</div><div className="muted small">{costQty < qty ? (zh ? `${qty - costQty} 瓶無採購價格` : `${qty - costQty} without cost`) : ''}</div></div>
        <div className="card kpi"><div className="l">{zh ? '市值小計' : 'Market value'}</div><div className="v">{ntd(price ? price.price * qty : null)}</div></div>
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>{zh ? '酒款資料' : 'Wine details'}</h2>
          <dl className="dl">
            <dt>{t('wineNo')}</dt><dd>{w.wine_no}</dd>
            <dt>{t('country')}</dt><dd>{w.country || '—'}</dd>
            <dt>{t('winery')}</dt><dd>{w.winery}</dd>
            <dt>{t('region')}</dt><dd>{w.region || '—'}</dd>
            <dt>{t('vintage')}</dt><dd>{w.vintage}</dd>
            <dt>{t('type')}</dt><dd>{zh ? w.type_zh : w.type_en}</dd>
            <dt>{t('volume')}</dt><dd>{w.volume_ml ? w.volume_ml + ' ml' : '—'}</dd>
            <dt>{t('suggested')}</dt><dd>{ntd(w.suggested_price)}</dd>
            {w.grapes && <><dt>{zh ? '葡萄品種' : 'Grapes'}</dt><dd>{w.grapes}</dd></>}
            {w.classification && <><dt>{zh ? '分級' : 'Classification'}</dt><dd>{w.classification}</dd></>}
            {w.notes && <><dt>{zh ? '備註' : 'Notes'}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{w.notes}</dd></>}
          </dl>
        </div>
        <div className="card">
          <h2>{t('priceHistory')}</h2>
          {!prices.length ? <div className="muted">—</div> : (
            <div className="bars">{prices.map((p) => (
              <div className="bar" key={p.id} style={{ gridTemplateColumns: '92px 1fr 88px 28px', opacity: p.voided ? 0.4 : 1 }}>
                <span title={p.source}>{p.effective_date}</span>
                <span className="track"><span className="fill" style={{ width: (p.price / maxP) * 100 + '%', display: 'block' }} /></span>
                <span className="num" style={{ textDecoration: p.voided ? 'line-through' : 'none' }}>{ntd(p.price)}</span>
                {!p.voided ? <button className="btn ghost mini" style={{ padding: 0, minHeight: 24 }} title={zh ? '作廢' : 'Void'} onClick={() => setVoidId(p.id)}>×</button> : <span />}
              </div>))}
              <div className="muted small">{t('source')}：{[...new Set(prices.map((p) => p.source))].join('、')}</div>
            </div>)}
        </div>
      </div>
      <div className="card">
        <div className="row between"><h2>{zh ? '照片' : 'Photos'}</h2><button className="btn mini" onClick={() => fileRef.current.click()}>{zh ? '上傳 / 拍照' : 'Upload / take photo'}</button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></div>
        {photos.data?.length ? (
          <div className="photos">{photos.data.map((p) => (
            <div className="photo" key={p.id}>
              <img src={'/api/photo/' + p.file} alt={w.name} loading="lazy" />
              {p.is_main ? <span className="tag wine main">{zh ? '主圖' : 'Main'}</span> : null}
              <div className="acts">
                {!p.is_main ? <button onClick={async () => { await run(() => api(`/api/photos/${p.id}/main`, { method: 'PUT' })); reload(); }}>{zh ? '設為主圖' : 'Make main'}</button> : <span />}
                <button onClick={async () => { if (confirm(zh ? '刪除這張照片？' : 'Delete photo?')) { await run(() => api('/api/photos/' + p.id, { method: 'DELETE' })); reload(); } }}>{zh ? '刪除' : 'Delete'}</button>
              </div>
            </div>))}</div>
        ) : <div className="muted small">{zh ? '還沒有照片。手機可直接拍照上傳。' : 'No photos yet.'}</div>}
      </div>
      <div className="card">
        <h2>{zh ? '存放位置' : 'Where it is'}</h2>
        <div className="tbl-wrap"><table className="tbl stack">
          <thead><tr><th>{t('location')}</th><th>{t('caseNo')}</th><th className="num">{t('qty')}</th><th>{t('merchant')}</th><th className="num">{t('cost')}</th></tr></thead>
          <tbody>{locations.map((l, i) => (
            <tr key={i}>
              <td><Link to={'/storage/' + l.locker_id}>{l.cellar} › {l.locker}</Link> › {l.rack}{l.uncertain ? <> <span className="tag warn">{t('uncertain')}</span></> : null}</td>
              <td>{l.case_no ? <Link to={'/cases/' + encodeURIComponent(l.case_no)}>{l.case_no}</Link> : <span className="tag">{t('loose')}</span>}</td>
              <td className="num">{l.qty}{l.reserved ? <div className="sub">{zh ? `保留 ${l.reserved}` : `${l.reserved} reserved`}</div> : null}</td><td>{l.merchant || '—'}</td><td className="num">{ntd(l.cost)}</td>
            </tr>))}</tbody></table></div>
      </div>
      <details className="card" open={sel.length > 0}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{zh ? `每瓶明細（${bottles.length}）` : `Bottles (${bottles.length})`}</summary>
        <div className="row" style={{ margin: '12px 0' }}>
          <label className="check"><input type="checkbox" checked={sel.length === inStock.length && inStock.length > 0} onChange={(e) => setSel(e.target.checked ? inStock.map((b) => b.bottle_no) : [])} />{zh ? '全選在庫' : 'Select in stock'}</label>
          <span className="muted">{zh ? `已選 ${sel.length} 瓶` : `${sel.length} selected`}</span>
          <button className="btn mini" disabled={!sel.length} onClick={() => nav('/move?k=' + handoff({ what: 'bottles', bottle_nos: sel }))}>{zh ? '移動' : 'Move'}</button>
          <button className="btn mini" disabled={!sel.length} onClick={() => nav('/labels?k=' + handoff({ kind: 'bottle', bottle_nos: sel }))}>{zh ? '列印瓶標' : 'Print labels'}</button>
          <button className="btn mini" disabled={!sel.length} onClick={() => setDlg('out')}>{zh ? '出庫' : 'Remove'}</button>
          <button className="btn mini" disabled={!sel.length} onClick={() => setDlg('status')}>{zh ? '變更狀態' : 'Change status'}</button>
        </div>
        <div className="tbl-wrap"><table className="tbl stack">
          <thead><tr><th style={{ width: 36 }}></th><th>{t('bottleNo')}</th><th>{t('caseNo')}</th><th>{t('location')}</th><th>{t('status')}</th><th>{zh ? '標籤' : 'Label'}</th></tr></thead>
          <tbody>{bottles.map((b) => <tr key={b.bottle_no}>
            <td>{b.status === 'in_stock' ? <input type="checkbox" style={{ width: 18, height: 18, accentColor: 'var(--wine)' }} checked={sel.includes(b.bottle_no)} onChange={() => toggle(b.bottle_no)} aria-label={b.bottle_no} /> : null}</td>
            <td><Link to={'/bottles/' + b.bottle_no}>{b.bottle_no}</Link></td><td>{b.case_no || t('loose')}</td><td>{b.cellar} › {b.locker} › {b.rack}</td>
            <td>{b.status === 'in_stock' ? t(b.status) : <span className="tag warn" title={b.out_reason || ''}>{t(b.status)}{b.out_reason ? '：' + b.out_reason : ''}</span>}</td><td className="muted small">{b.label_printed_at ? b.label_printed_at.slice(0, 10) : (zh ? '未列印' : 'Not printed')}</td></tr>)}</tbody>
        </table></div>
      </details>
      {sales.data?.length > 0 && <div className="card"><h2>{zh ? '銷售紀錄' : 'Sales'}</h2>
        <div className="tbl-wrap"><table className="tbl stack"><thead><tr><th>{zh ? '日期' : 'Date'}</th><th>{zh ? '訂單' : 'Order'}</th><th>{zh ? '客戶' : 'Customer'}</th><th className="num">{zh ? '數量' : 'Qty'}</th><th className="num">{zh ? '單價' : 'Price'}</th></tr></thead>
          <tbody>{sales.data.map((x) => <tr key={x.order_no}><td>{x.order_date}</td><td><Link to={'/orders/' + x.order_no}>{x.order_no}</Link></td><td>{x.customer}</td><td className="num">{x.qty}</td><td className="num">{ntd(x.unit_price)}{x.discount ? <div className="sub">−{x.discount}%</div> : null}</td></tr>)}</tbody></table></div></div>}
      <div className="card"><h2>{t('audit')}</h2><LogTable rows={logs} /></div>

      {dlg === 'price' && (
        <Modal title={zh ? '更新市場價格' : 'Update market price'} onClose={() => setDlg(null)}
          footer={<><button className="btn" onClick={() => setDlg(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!pf.price} onClick={savePrice}>{zh ? '儲存' : 'Save'}</button></>}>
          <div className="muted small">{zh ? '目前' : 'Current'}：{ntd(price?.price)} {price?.effective_date}</div>
          <label className="f">{zh ? '市場價格（NT$ / 瓶）' : 'Market price (NT$)'}<input className="input" inputMode="numeric" value={pf.price} onChange={(e) => setPf({ ...pf, price: e.target.value })} autoFocus /></label>
          <div className="grid g2" style={{ gap: 10 }}>
            <label className="f">{zh ? '查價日期' : 'Date'}<input className="input" type="date" value={pf.date} onChange={(e) => setPf({ ...pf, date: e.target.value })} /></label>
            <label className="f">{zh ? '來源' : 'Source'}<input className="input" value={pf.source} onChange={(e) => setPf({ ...pf, source: e.target.value })} placeholder="Wine-Searcher" /></label>
          </div>
          <div className="muted small">{zh ? '一次查一批請用清單的「更新市場價格」（查價助手）。' : 'For many wines at once, use a list’s price update.'}</div>
        </Modal>
      )}
      {voidId && (
        <Modal title={zh ? '作廢價格紀錄' : 'Void price'} onClose={() => setVoidId(null)}
          footer={<><button className="btn" onClick={() => setVoidId(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!reason.trim()} onClick={doVoid}>{zh ? '作廢' : 'Void'}</button></>}>
          <div className="muted small">{zh ? '作廢的價格會保留但不再使用，並記入異動紀錄。' : 'The entry is kept but no longer used.'}</div>
          <label className="f">{zh ? '原因 *' : 'Reason *'}<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
        </Modal>
      )}
      {dlg === 'list' && <AddToList body={{ wine_nos: [w.wine_no] }} zh={zh} onClose={() => setDlg(null)} />}
      {dlg === 'out' && <StockoutModal bottle_nos={sel} zh={zh} onClose={(n) => { setDlg(null); if (n) { setSel([]); reload(); } }} />}
      <DeleteWine no={w.wine_no} zh={zh} />
      {dlg === 'status' && <StatusModal bottle_nos={sel} zh={zh} onClose={(changed) => { setDlg(null); if (changed) { setSel([]); reload(); } }} />}
    </div>
  );
}

// 刪除輸入錯誤的酒款（只限從未上過訂單或出貨）
function DeleteWine({ no, zh }) {
  const nav = useNavigate();
  const [st, setSt] = useState(null);
  const [reason, setReason] = useState('');
  const check = async () => setSt(await api(`/api/wines/${no}/deletable`));
  return (
    <div className="muted small" style={{ textAlign: 'right' }}>
      <button className="btn ghost mini" style={{ color: 'var(--err)' }} onClick={check}>{zh ? '刪除這款酒（輸入錯誤時）' : 'Delete this wine (entry error)'}</button>
      {st && (
        <Modal title={zh ? '刪除酒款 ' + no : 'Delete wine ' + no} onClose={() => setSt(null)}
          footer={<><button className="btn" onClick={() => setSt(null)}>{zh ? '取消' : 'Cancel'}</button>{st.ok && <button className="btn primary" style={{ background: 'var(--err)', borderColor: 'var(--err)' }} disabled={!reason.trim()} onClick={async () => { await run(() => api('/api/wines/' + no, { method: 'DELETE', body: { reason } }), zh ? '已刪除酒款' : 'Deleted'); nav('/search'); }}>{zh ? '永久刪除' : 'Delete permanently'}</button>}</>}>
          {st.ok ? <>
            <div className="alert err">{zh ? `會刪除這款酒和它的 ${st.bottles} 個瓶號、價格歷史與照片，無法復原。異動紀錄會保留刪除前的資料。只在「輸入錯誤」時使用；酒拿走了請用「出庫」。` : `Deletes the wine, its ${st.bottles} bottles, prices and photos. Cannot be undone.`}</div>
            <label className="f">{zh ? '原因 *' : 'Reason *'}<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={zh ? '例：重複建立、年份打錯' : 'e.g. duplicate entry'} /></label>
          </> : <div className="alert">{st.why}</div>}
        </Modal>
      )}
    </div>
  );
}
