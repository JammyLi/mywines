import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ntd, num } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { Modal, run, toast } from '../ui.jsx';
import { BatchBar } from './Settings.jsx';

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const pctTxt = (from, to) => (from && to ? ((to - from) / from * 100).toFixed(1) : null);

// ===== 市場價格批次更新（在列表中編輯）=====
export function PriceUpdate() {
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const list = sp.get('list') || '';
  const { data: lists } = useApi('/api/lists');
  const [v, setV] = useState(0);
  const { data } = useApi(`/api/price/queue${list ? '?list=' + list : '?stale=1'}&v=${v}`);
  const [vals, setVals] = useState({});
  const [date, setDate] = useState(today());
  const [source, setSource] = useState('');
  const [big, setBig] = useState(null);
  useEffect(() => setVals({}), [list]);
  const filled = data ? data.items.filter((i) => vals[i.wine_no]) : [];
  const save = async (confirm = []) => {
    try {
      const r = await api('/api/prices/batch', { method: 'POST', body: { date, source, items: filled.map((i) => ({ wine_no: i.wine_no, price: vals[i.wine_no] })), confirm } });
      toast(zh ? `已儲存 ${r.saved} 筆價格` : `Saved ${r.saved}`); setVals({}); setBig(null); setV(v + 1);
    } catch (e) {
      if (e.status === 409 && e.data?.big) setBig(e.data.big);
      else toast(e.message, 'err');
    }
  };
  return (
    <div className="page">
      <div className="row between"><h1>{zh ? '市場價格更新' : 'Market prices'}</h1>
        <div className="row"><Link className="btn primary" to={'/prices/helper' + (list ? '?list=' + list : '?stale=1')}>{zh ? '開始查價助手' : 'Start price helper'}</Link></div></div>
      <div className="muted small">{zh ? '每次更新都新增一筆價格歷史，不覆蓋舊價格。' : 'Every update adds a history entry; old prices are kept.'}</div>
      <div className="card row" style={{ alignItems: 'flex-end' }}>
        <label className="f" style={{ minWidth: 240 }}>{zh ? '顯示' : 'Show'}<select className="input" value={list} onChange={(e) => setSp(e.target.value ? { list: e.target.value } : {})}>
          <option value="">{zh ? `超過 30 天未更新${data && !list ? `（${data.cases} 箱 · ${data.items.length} 款）` : ''}` : 'Older than 30 days'}</option>
          {lists?.map((l) => <option key={l.id} value={l.id}>{zh ? '我的清單：' : 'List: '}{l.name}</option>)}</select></label>
        <label className="f">{zh ? '查價日期（套用全部）' : 'Date (all rows)'}<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f">{zh ? '來源（套用全部）' : 'Source (all rows)'}<input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder={zh ? '例：Wine-Searcher、酒商報價' : 'e.g. Wine-Searcher'} /></label>
        <span style={{ flex: 1 }} />
        <BatchBar kind="prices" label={zh ? '市場價格' : 'Market prices'} zh={zh} onDone={() => setV(v + 1)} />
      </div>
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr><th>{t('name')}</th><th>{t('vintage')}</th><th className="num">{t('qty')}</th><th className="num">{zh ? '目前市場價格' : 'Current'}</th><th>{zh ? '上次查價' : 'Last checked'}</th><th style={{ width: 150 }}>{zh ? '新市場價格' : 'New price'}</th><th className="num">{zh ? '變動' : 'Change'}</th></tr></thead>
        <tbody>{data?.items.map((i) => { const p = pctTxt(i.price, Number(vals[i.wine_no])); return (
          <tr key={i.wine_no}><td><Link to={'/wines/' + i.wine_no}>{i.name}</Link><div className="sub">{i.winery}</div></td><td>{i.vintage}</td><td className="num">{i.qty}</td><td className="num">{ntd(i.price)}</td>
            <td>{i.price_date && i.price_date >= data.staleBefore ? i.price_date : <span className="tag warn">{i.price_date || (zh ? '無' : 'none')}</span>}</td>
            <td><input className="input" style={{ minHeight: 34 }} inputMode="numeric" value={vals[i.wine_no] || ''} onChange={(e) => setVals({ ...vals, [i.wine_no]: e.target.value.replace(/[^\d]/g, '') })} aria-label={i.name + (zh ? ' 新市場價格' : ' new price')} /></td>
            <td className="num" style={{ color: p && Math.abs(p) > 20 ? 'var(--err)' : undefined, fontWeight: p && Math.abs(p) > 20 ? 600 : 400 }}>{p ? (p > 0 ? '+' : '') + p + '%' : ''}</td></tr>); })}</tbody>
      </table></div>
      {data && !data.items.length && <div className="card muted">{zh ? '沒有需要更新的酒款 🎉' : 'Nothing to update'}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <span className="muted small">{zh ? `${filled.length} 筆有新價格 · 其餘留空的列不會更新 · 變動超過 ±20% 會要求再次確認` : `${filled.length} new prices · blanks are skipped · changes over ±20% need confirmation`}</span>
        <button className="btn" onClick={() => nav(-1)}>{zh ? '取消' : 'Cancel'}</button>
        <button className="btn primary" disabled={!filled.length} onClick={() => save()}>{zh ? `儲存 ${filled.length} 筆價格` : `Save ${filled.length}`}</button>
      </div>
      {big && (
        <Modal title={zh ? '價格變動超過 ±20%' : 'Large price changes'} onClose={() => setBig(null)}
          footer={<><button className="btn" onClick={() => setBig(null)}>{zh ? '回去修改' : 'Go back'}</button><button className="btn primary" onClick={() => save(big.map((b) => b.wine_no))}>{zh ? '確認，全部儲存' : 'Confirm & save'}</button></>}>
          {big.map((b) => <div key={b.wine_no} className="row between"><span>{b.name}</span><b style={{ color: 'var(--err)' }}>{ntd(b.from)} → {ntd(b.to)}（{(b.change * 100).toFixed(1)}%）</b></div>)}
        </Modal>
      )}
    </div>
  );
}

// ===== 查價助手 =====
let wsWin = null; // 上次開啟的 Wine-Searcher 分頁
export function PriceHelper() {
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const qs = sp.toString();
  const [key, setKey] = useState(null); // 進度依「清單＋內容」記錄
  const [data, setData] = useState(null);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState({});
  const chRef = useRef(null);
  const aliveRef = useRef(0);
  const [quota, setQuota] = useState(null);
  const [opened, setOpened] = useState(null); // { lookup_id, url, wine_no }
  const [price, setPrice] = useState('');
  const [url, setUrl] = useState('');
  const [fromHelper, setFromHelper] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [waitUntil, setWaitUntil] = useState(0);
  const [confirmBig, setConfirmBig] = useState(false);
  const { data: settings } = useApi('/api/settings');
  const { data: listInfo } = useApi(sp.get('list') ? '/api/lists/' + sp.get('list') : '/api/me');
  const priceRef = useRef();

  useEffect(() => { api('/api/price/queue?' + qs).then((d) => {
    const sig = d.items.map((w) => w.wine_no).join(',');
    let hsh = 0; for (const ch of sig) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
    const k = `helper:${qs}:${d.items.length}:${hsh}`;
    let savedDone = {}; try { savedDone = JSON.parse(localStorage.getItem(k + ':done') || '{}'); } catch { /* */ }
    const valid = Object.fromEntries(Object.entries(savedDone).filter(([no]) => d.items.some((w) => w.wine_no === no)));
    setDone(valid); setIdx(Math.min(Number(localStorage.getItem(k) || 0), d.items.length)); setKey(k);
    setData(d); setQuota(d.quota); setWaitUntil(Date.now() + d.quota.wait_ms);
  }); }, [qs]);
  useEffect(() => { const tm = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(tm); }, []);
  useEffect(() => { if (key) localStorage.setItem(key, String(idx)); }, [idx, key]);
  useEffect(() => { if (key) localStorage.setItem(key + ':done', JSON.stringify(done)); }, [done, key]);
  // 書籤「查價助手」從 Wine-Searcher 頁送回價格
  useEffect(() => {
    let ch;
    const take = (m) => { if (m?.type === 'tab-alive') { aliveRef.current = Date.now(); return; } if (m?.type || !m?.price) return; setPrice(String(m.price).replace(/[^\d]/g, '')); if (m.url) setUrl(m.url); setFromHelper(true); window.focus(); priceRef.current?.focus(); };
    try { ch = new BroadcastChannel('mywines-price'); ch.onmessage = (e) => take(e.data); chRef.current = ch; } catch { /* */ }
    const onStorage = (e) => { if (e.key === 'mywines-price' && e.newValue) take(JSON.parse(e.newValue)); };
    window.addEventListener('storage', onStorage);
    return () => { ch?.close(); window.removeEventListener('storage', onStorage); };
  }, []);

  if (!data) return <div className="page muted">{t('loading')}</div>;
  const items = data.items;
  const cur = items[Math.min(idx, items.length - 1)];
  const finished = idx >= items.length;
  const wait = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  const limitHit = quota && (quota.hour >= quota.per_hour || quota.day >= quota.per_day);
  const change = cur && price ? pctTxt(cur.price, Number(price)) : null;

  // 重複使用同一個 Wine-Searcher 分頁：
  // 1) 按過書籤後，那個分頁會變成「查價分頁」並保持開著，下一款直接在那個分頁切換（最可靠）
  // 2) 否則沿用上次開的分頁；Wine-Searcher 若隔離分頁，瀏覽器才會開新分頁
  const open = async () => {
    const viaTab = Date.now() - aliveRef.current < 5000;
    const prev = wsWin && !wsWin.closed ? wsWin : null;
    const w = viaTab ? null : prev || window.open('about:blank', 'wine-searcher'); // 先開視窗，避免被擋
    try {
      const r = await api('/api/price/open', { method: 'POST', body: { wine_no: cur.wine_no } });
      setOpened({ ...r, wine_no: cur.wine_no }); setQuota(r.quota); setWaitUntil(Date.now() + r.quota.wait_ms);
      setUrl(r.url); setFromHelper(false); setPrice('');
      if (viaTab) { chRef.current?.postMessage({ type: 'nav', url: r.url }); toast(zh ? '已在查價分頁開啟，請切換到那個分頁' : 'Opened in the price tab'); }
      else {
        let target = w;
        try { if (target) target.location.href = r.url; else target = window.open(r.url, 'wine-searcher'); } catch { target = window.open(r.url, 'wine-searcher'); }
        wsWin = target; try { target?.focus(); } catch { /* */ }
      }
    } catch (e) { if (w && w !== prev) w.close(); toast(e.message, 'err'); api('/api/price/quota').then((q) => { setQuota(q); setWaitUntil(Date.now() + q.wait_ms); }); }
  };
  const next = () => { setIdx(idx + 1); setOpened(null); setPrice(''); setUrl(''); setFromHelper(false); setConfirmBig(false); };
  const save = async (force) => {
    try {
      await api('/api/price/save', { method: 'POST', body: { wine_no: cur.wine_no, price, url, lookup_id: opened?.wine_no === cur.wine_no ? opened.lookup_id : null, confirm: force } });
      toast(zh ? `已更新 ${cur.name}：${ntd(Number(price))}` : 'Saved');
      setDone({ ...done, [cur.wine_no]: 'saved' }); next();
    } catch (e) { if (e.status === 409) setConfirmBig(true); else toast(e.message, 'err'); }
  };
  const skip = async () => {
    if (opened?.wine_no === cur.wine_no) api('/api/price/skip', { method: 'POST', body: { lookup_id: opened.lookup_id } }).catch(() => {});
    setDone({ ...done, [cur.wine_no]: 'skipped' }); next();
  };
  const title = listInfo?.name ? listInfo.name : zh ? '超過 30 天未更新' : 'Stale prices';
  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="crumbs">{sp.get('list') ? <Link to={'/lists/' + sp.get('list')}>{title}</Link> : <Link to="/prices">{zh ? '市場價格' : 'Market prices'}</Link>}›<span>{zh ? '查價助手' : 'Price helper'}</span></div>
      <div className="row between">
        <h1>{zh ? '查價助手' : 'Price helper'}</h1>
        <div className="row">
          {quota && <><span className={'tag' + (quota.hour >= quota.per_hour ? ' warn' : '')}>{zh ? '本小時' : 'This hour'} {quota.hour} / {quota.per_hour}</span><span className={'tag' + (quota.day >= quota.per_day ? ' warn' : '')}>{zh ? '今天' : 'Today'} {quota.day} / {quota.per_day}</span></>}
          <button className="btn" onClick={() => nav(sp.get('list') ? '/lists/' + sp.get('list') : '/prices')}>{zh ? '暫停，下次繼續' : 'Pause'}</button>
        </div>
      </div>
      <div className="muted small">{zh ? `${sp.get('list') ? `清單 ${data.cases} 箱整理成 ${items.length} 款酒，每款只查一次。` : `${items.length} 款酒需要更新。`}由你在自己的瀏覽器查價，系統不自動登入或抓取網頁。` : `${items.length} wines. You look up prices in your own browser; the system never logs in or scrapes.`}</div>
      {finished ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="alert ok">{zh ? `完成！這份清單 ${items.length} 款：更新 ${Object.values(done).filter((x) => x === 'saved').length} 款，略過 ${Object.values(done).filter((x) => x === 'skipped').length} 款。` : `Done! ${items.length} wines.`}</div>
          <div className="row"><button className="btn" onClick={() => { setIdx(0); setDone({}); }}>{zh ? '從頭再看一次' : 'Start over'}</button><Link className="btn primary" to={sp.get('list') ? '/lists/' + sp.get('list') : '/prices'}>{zh ? '回去' : 'Back'}</Link></div>
        </div>
      ) : (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="muted small">{zh ? `第 ${idx + 1} / ${items.length} 款` : `${idx + 1} of ${items.length}`}</div>
              <b style={{ fontSize: 18 }}>{cur.name}</b>
              <span className="muted">{cur.winery} · {cur.vintage} · {zh ? cur.type_zh : cur.type_en} · {cur.volume_ml} ml · {zh ? `在庫 ${cur.qty} 瓶` : `${cur.qty} in stock`}</span>
              {cur.done && <span className="tag ok" style={{ alignSelf: 'flex-start' }}>{zh ? '今天已查過' : 'Checked today'}</span>}
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row"><span className="tag wine">1</span>{opened?.wine_no === cur.wine_no ? <b>{zh ? '已開啟 Wine-Searcher 查詢頁' : 'Wine-Searcher page opened'}</b> : <b>{zh ? '開啟查詢頁' : 'Open the search page'}</b>}</div>
              <button className="btn primary" disabled={wait > 0 || limitHit} onClick={open}>
                {limitHit ? (zh ? '已達查價上限' : 'Limit reached') : wait > 0 ? (zh ? `請稍候 ${wait} 秒` : `Wait ${wait}s`) : opened?.wine_no === cur.wine_no ? (zh ? '重新開啟' : 'Reopen') : (zh ? '開啟 Wine-Searcher' : 'Open Wine-Searcher')}</button>
              <div className="muted small">{zh ? `每款之間隨機等 ${quota?.min_wait}–${quota?.max_wait} 秒；每小時最多 ${quota?.per_hour} 款、每天 ${quota?.per_day} 款。` : `Random ${quota?.min_wait}–${quota?.max_wait}s between wines.`}</div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row"><span className="tag wine">2</span><b>{fromHelper ? (zh ? '已從查價助手讀到價格' : 'Price received from the helper') : (zh ? '輸入價格' : 'Enter the price')}</b></div>
              <div className="grid g2" style={{ gap: 10 }}>
                <div><div className="muted small">{zh ? '目前市場價格' : 'Current'}</div><b>{ntd(cur.price)}</b> <span className="muted small">{cur.price_date}</span></div>
                <label className="f">{zh ? `讀到的價格（NT$ / ${cur.volume_ml} ml）` : `Price (NT$ / ${cur.volume_ml} ml)`}<input ref={priceRef} className="input" inputMode="numeric" value={price} onChange={(e) => { setPrice(e.target.value.replace(/[^\d]/g, '')); setFromHelper(false); }} onKeyDown={(e) => e.key === 'Enter' && price && save(false)} /></label>
              </div>
              {change && <div className={Math.abs(change) > 20 ? 'alert err' : 'muted small'}>{zh ? '變動' : 'Change'} {change > 0 ? '+' : ''}{change}% · {Math.abs(change) > 20 ? (zh ? '超過 ±20%，請確認沒有看錯（例如不同容量或含稅）' : 'over ±20% — double-check') : (zh ? '未超過 ±20%' : 'within ±20%')}</div>}
              {url && <div className="muted small" style={{ wordBreak: 'break-all' }}>{zh ? '來源網址：' : 'Source: '}{url}</div>}
              <div className="row">
                <button className="btn primary" disabled={!price} onClick={() => save(false)}>{fromHelper ? (zh ? '採用，下一款' : 'Use it, next') : (zh ? '儲存，下一款' : 'Save, next')}</button>
                <button className="btn" onClick={skip}>{zh ? '略過' : 'Skip'}</button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card">
              <h2>{zh ? '怎麼用' : 'How it works'}</h2>
              <ol className="small" style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>{zh ? '你平常就在這個瀏覽器登入 Wine-Searcher。系統不儲存你的帳號密碼。' : 'Stay logged in to Wine-Searcher in this browser. Your password is never stored.'}</li>
                <li>{zh ? '按「開啟 Wine-Searcher」，看到價格後按書籤列的「查價助手」：只讀取這一頁的價格與網址，送回系統。那個分頁會留著當「查價分頁」，下一款直接在同一個分頁開啟，不會一直開新分頁。' : 'Open Wine-Searcher, then click the “查價助手” bookmark. That tab stays as the price tab and the next wine opens in it.'}</li>
                <li>{zh ? '讀不到時，直接在左邊輸入價格，流程不中斷。' : 'If it can’t read it, type the price on the left.'}</li>
              </ol>
              <div className="muted small" style={{ marginTop: 8 }}>{zh ? '還沒有書籤？到' : 'No bookmark yet? See '}<Link to="/settings/price">{zh ? '設定 › 查價設定' : 'Settings › Price lookup'}</Link>{zh ? '，把按鈕拖到書籤列。' : '.'}</div>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="tbl">
              <tbody>{items.map((w, k) => (
                <tr key={w.wine_no} style={{ background: k === idx ? 'var(--wine-soft)' : undefined, cursor: 'pointer' }} onClick={() => { setIdx(k); setOpened(null); setPrice(''); setUrl(''); }}>
                  <td style={{ width: 70 }}>{done[w.wine_no] === 'saved' ? <span className="tag ok">{zh ? '已更新' : 'Done'}</span> : done[w.wine_no] === 'skipped' ? <span className="tag">{zh ? '略過' : 'Skipped'}</span> : k === idx ? <span className="tag wine">{zh ? '查價中' : 'Now'}</span> : <span className="tag">{zh ? '待查' : 'To do'}</span>}</td>
                  <td>{w.name}<div className="sub">{w.vintage} · {w.qty} {zh ? '瓶' : 'btl'}</div></td><td className="num">{ntd(w.price)}</td></tr>))}</tbody>
            </table></div>
            {settings && <div className="muted small">{zh ? '查價網址範本：' : 'URL template: '}{settings.price.url_template}</div>}
          </div>
        </div>
      )}
      {confirmBig && (
        <Modal title={zh ? '價格變動超過 ±20%' : 'Large change'} onClose={() => setConfirmBig(false)}
          footer={<><button className="btn" onClick={() => setConfirmBig(false)}>{zh ? '修改' : 'Edit'}</button><button className="btn primary" onClick={() => { setConfirmBig(false); save(true); }}>{zh ? '確認採用' : 'Confirm'}</button></>}>
          <div>{cur.name}：{ntd(cur.price)} → <b>{ntd(Number(price))}</b>（{change}%）</div>
          <div className="muted small">{zh ? '請確認是同一容量（750 ml）、同一年份，且不是含稅或含運的價格。' : 'Check the bottle size, vintage and that tax/shipping is not included.'}</div>
        </Modal>
      )}
    </div>
  );
}

// ===== 書籤送回的頁面 =====
export function PriceReturn() {
  const [sp] = useSearchParams();
  const zh = (localStorage.getItem('lang') || 'zh') !== 'en';
  const msg = useMemo(() => ({ price: sp.get('price'), url: sp.get('url'), at: Date.now() }), [sp]);
  const popup = !!window.opener; // 舊版書籤用小視窗；新版在同一個分頁
  useEffect(() => {
    let ch;
    try { ch = new BroadcastChannel('mywines-price'); ch.postMessage(msg); } catch { /* */ }
    try { localStorage.setItem('mywines-price', JSON.stringify(msg)); } catch { /* */ }
    if (popup) { const tm = setTimeout(() => window.close(), 900); return () => { clearTimeout(tm); ch?.close(); }; }
    // 當「查價分頁」：查價助手按下一款時，這個分頁直接切到 Wine-Searcher
    const beat = () => ch?.postMessage({ type: 'tab-alive' });
    beat();
    const iv = setInterval(beat, 1500);
    if (ch) ch.onmessage = (e) => { if (e.data?.type === 'nav' && e.data.url) location.href = e.data.url; };
    return () => { clearInterval(iv); ch?.close(); };
  }, [msg, popup]);
  return (
    <div className="login-wrap"><div className="card login" style={{ textAlign: 'center' }}>
      <b style={{ fontSize: 18 }}>{zh ? '已送回查價助手' : 'Sent to the price helper'}</b>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{msg.price ? 'NT$' + num(Number(String(msg.price).replace(/[^\d]/g, ''))) : '—'}</div>
      <div className="muted small">{popup ? (zh ? '這個視窗會自動關閉。' : 'This window closes by itself.') : (zh ? '請切回查價助手確認。這個分頁請保持開著：下一款會自動在這裡開啟 Wine-Searcher。' : 'Switch back to the helper. Keep this tab open: the next wine opens here.')}</div>
      {msg.url && <a className="small" href={msg.url}>{zh ? '回到剛才的 Wine-Searcher 頁面' : 'Back to the Wine-Searcher page'}</a>}
    </div></div>
  );
}

// 書籤程式：只讀取使用者正在看的這一頁的價格與網址，送回系統
export function bookmarkletCode(origin) {
  const js = `(function(){var t=document.body.innerText||'';var m=t.match(/Avg[^\\n]{0,40}?(?:NT\\$|TWD|NTD)\\s?([\\d,]{2,})/i)||t.match(/(?:NT\\$|TWD|NTD)\\s?([\\d,]{3,})/);var g=m?m[1].replace(/,/g,''):'';var p=prompt('查價助手：確認這一頁的價格（NT$ / 瓶）',g);if(p===null)return;location.href='${origin}/price/return?price='+encodeURIComponent(p)+'&url='+encodeURIComponent(location.href);})();`;
  return 'javascript:' + js;
}
