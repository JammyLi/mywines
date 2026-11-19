import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ntd } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { download, run } from '../ui.jsx';
import { handoff, receive } from '../handoff.js';

export const COLS = [
  ['name', '品名 / 酒莊', 'Name / winery', true], ['vintage', '年份 / 產區', 'Vintage / region', true], ['qty', '瓶數', 'Bottles', true], ['suggested_price', '建議售價', 'Suggested price', true],
  ['price', '市場價格', 'Market price', false], ['location', '位置 / 箱號', 'Location / cases', false], ['type', '種類', 'Type', false], ['volume_ml', '容量', 'Volume', false],
];
// 畫面欄位 → 匯出欄位
export const expand = (cols, cost) => [...cols.flatMap((c) => ({ name: ['winery', 'name'], vintage: ['vintage', 'region'], location: ['location', 'cases'] }[c] || [c])), ...(cost ? ['cost', 'merchants'] : [])];

export default function Export() {
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const ho = useMemo(() => receive(sp.get('k')), [sp]);
  const list = sp.get('list');
  const src = list ? { list } : { query: ho?.query || {} };
  const { data: lists } = useApi('/api/lists');
  const { data: settings } = useApi('/api/settings');
  const [fmt, setFmt] = useState('xlsx');
  const [layout, setLayout] = useState('table');
  const [cols, setCols] = useState(COLS.filter((c) => c[3]).map((c) => c[0]));
  const [cost, setCost] = useState(false);
  const [lang, setLang] = useState(t.lang === 'en' ? 'en' : 'zh');
  const [busy, setBusy] = useState(false);
  const title = list ? lists?.find((l) => String(l.id) === list)?.name : ho?.title || (zh ? '搜尋結果' : 'Search results');
  const co = settings?.company;
  const go = async () => {
    setBusy(true);
    try {
      const body = { ...src, columns: expand(cols, cost), lang, title };
      if (fmt === 'xlsx') await run(() => download('/api/export/xlsx', body, 'export.xlsx'), zh ? '已下載 Excel' : 'Excel downloaded');
      else nav('/print/export?k=' + handoff({ ...body, layout, cols, cost }));
    } catch { /* */ } finally { setBusy(false); }
  };
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="crumbs">{list ? <Link to={'/lists/' + list}>{zh ? '我的清單' : 'My lists'}</Link> : <Link to="/search">{zh ? '庫存搜尋' : 'Search'}</Link>}›<span>{zh ? '匯出' : 'Export'}</span></div>
      <h1>{zh ? '匯出' : 'Export'}<span className="muted" style={{ fontSize: 16, fontWeight: 400 }}> · {title}</span></h1>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="radio-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <label className={fmt === 'xlsx' ? 'on' : ''}><input type="radio" checked={fmt === 'xlsx'} onChange={() => setFmt('xlsx')} /><span>Excel (.xlsx)<div className="muted small">{zh ? '可再編輯、加總' : 'Editable'}</div></span></label>
            <label className={fmt === 'pdf' ? 'on' : ''}><input type="radio" checked={fmt === 'pdf'} onChange={() => setFmt('pdf')} /><span>PDF<div className="muted small">{zh ? '含公司抬頭，可給客戶' : 'With letterhead, for clients'}</div></span></label>
          </div>
          {fmt === 'pdf' && (
            <div className="fgroup"><b>{zh ? '版型' : 'Layout'}</b>
              <label className="check"><input type="radio" checked={layout === 'table'} onChange={() => setLayout('table')} />{zh ? '表格版' : 'Table'}</label>
              <label className="check"><input type="radio" checked={layout === 'catalog'} onChange={() => setLayout('catalog')} />{zh ? '型錄版（含酒標照片）' : 'Catalog (with photos)'}</label></div>
          )}
          <div className="fgroup"><b>{zh ? '欄位' : 'Columns'}</b><div className="cols-pick">{COLS.map(([k, a, b]) => (
            <label className="check" key={k}><input type="checkbox" checked={cols.includes(k)} onChange={() => setCols(cols.includes(k) ? cols.filter((x) => x !== k) : [...cols, k])} />{zh ? a : b}</label>))}</div></div>
          <label className="check" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={cost} onChange={(e) => setCost(e.target.checked)} /><span>{zh ? '包含採購價格與酒商' : 'Include purchase price & merchant'}<div className="small" style={{ color: 'var(--warn)' }}>{zh ? '內部用，勿傳給客戶；匯出會記入異動紀錄' : 'Internal only — logged'}</div></span></label>
          <div className="fgroup"><b>{zh ? '語言' : 'Language'}</b><div className="seg"><button className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')}>繁體中文</button><button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button></div></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => nav(-1)}>{zh ? '取消' : 'Cancel'}</button>
            <button className="btn primary" disabled={busy || !cols.length} onClick={go}>{zh ? '下載 ' : 'Download '}{fmt === 'xlsx' ? 'Excel' : 'PDF'}</button>
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>{zh ? '抬頭預覽' : 'Header preview'}</h2>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}>
            <div className="row between"><div><b>{lang === 'en' ? co?.name_en : co?.name_zh}</b><div className="muted small">{co?.phone} · {co?.email}</div></div><div className="muted small">{new Date().toISOString().slice(0, 10)}</div></div>
            <div style={{ fontSize: 18, fontWeight: 700, margin: '12px 0 4px' }}>{lang === 'en' ? 'Wine selection' : '酒款推薦'}</div>
            <div className="muted small">{title}</div>
          </div>
          <div className="muted small">{zh ? '公司資料在「設定 › 公司資料」修改。PDF 會開啟列印視窗，請選「另存為 PDF」。' : 'Company details are in Settings. PDF opens the print dialog — choose “Save as PDF”.'}</div>
        </div>
      </div>
    </div>
  );
}
