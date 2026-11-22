import Icon from '../icons.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, num } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';

const FIELD = { winery: ['酒莊', 'Winery'], merchant: ['酒商', 'Merchant'], region: ['產區', 'Region'] };

export default function Import() {
  const t = useT();
  const zh = t.lang !== 'en';
  const L = (p) => p[zh ? 0 : 1];
  const [step, setStep] = useState(1);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [prev, setPrev] = useState(null);
  const [picked, setPicked] = useState({});
  const [summary, setSummary] = useState(null);
  const [result, setResult] = useState(null);
  const fileRef = useRef();
  const history = useApi('/api/imports' + (result ? '?r=' + result.batchId : ''));

  const merges = () => {
    const m = { winery: {}, merchant: {}, region: {} };
    prev?.suggestions.forEach((s, i) => { if (picked[i]) m[s.field][s.from] = s.to; });
    return m;
  };

  const upload = async (file) => {
    if (!file) return;
    setErr(''); setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const p = await api('/api/import/preview', { method: 'POST', body: fd });
      setPrev(p); setSummary(p.summary);
      setPicked(Object.fromEntries(p.suggestions.map((s, i) => [i, !!s.auto])));
      setStep(2);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!prev) return;
    api('/api/import/summary', { method: 'POST', body: { token: prev.token, merges: merges() } }).then(setSummary).catch(() => {});
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    setErr(''); setBusy(true);
    try { setResult(await api('/api/import/commit', { method: 'POST', body: { token: prev.token, merges: merges() } })); setStep(3); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const reset = () => { setStep(1); setPrev(null); setResult(null); setErr(''); };
  const steps = zh ? ['1 選擇檔案', '2 檢查與合併', '3 完成'] : ['1 Choose file', '2 Review & merge', '3 Done'];

  return (
    <div className="page">
      <h1>{zh ? 'Excel 匯入' : 'Excel Import'}</h1>
      <div className="steps">{steps.map((s, i) => <span key={s} className={step === i + 1 ? 'on' : ''}>{s}</span>)}</div>
      {err && <div className="alert err" role="alert">{err}</div>}

      {step === 1 && (
        <>
          <div className={'drop' + (over ? ' over' : '')} role="button" tabIndex={0}
            onClick={() => fileRef.current.click()} onKeyDown={(e) => e.key === 'Enter' && fileRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}>
            <b style={{ fontSize: 16 }}>{busy ? t('loading') : zh ? '把 Excel 檔拖到這裡，或點一下選擇檔案' : 'Drop an Excel file here, or click to choose'}</b>
            <div className="muted" style={{ marginTop: 8 }}>.xlsx · {zh ? '第一列是欄位名稱' : 'First row holds the headers'}</div>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => upload(e.target.files[0])} />
          </div>
          <div className="card">
            <div className="row between"><h2 style={{ margin: 0 }}>{zh ? '欄位對應' : 'Column mapping'}</h2>
              <a className="btn" href="/api/import/template" download><Icon n="import" />{zh ? '下載匯入範本' : 'Download template'}</a></div>
            <div className="muted" style={{ marginTop: 8 }}>{zh ? '第一次匯入建議先下載範本，照欄位填好再上傳（範本裡有範例、欄位說明與種類代碼）。必填：酒莊、品名、瓶數。' : 'First time? Download the template, fill it in and upload it (it includes examples, column notes and type codes). Required: 酒莊, 品名, 瓶數.'}</div>
            <div className="muted" style={{ marginTop: 6 }}>{zh ? '酒窖 = 酒窖（Cellar）、位置 = 分儲空間（Locker）、架子 = 架子（Rack）、編號 = 箱號（Case）。沒有填架子時，酒箱放在該分儲空間的「未指定」架子。位置含「?」會標記為位置待確認。品名前面沒有酒莊時會自動補上；所有「備註」欄（備註、備註1…）合併成一個備註。' : '酒窖 = Cellar, 位置 = Locker, 架子 = Rack, 編號 = Case. Without a rack, cases go to the locker\'s "未指定" rack. A "?" in 位置 marks the case "location to confirm". The winery is added in front of 品名 when missing; all 備註 columns are merged into one note.'}</div>
          </div>
        </>
      )}

      {step === 2 && prev && (
        <>
          <div className="card row between">
            <div><b>{prev.filename}</b><div className="muted small">{num(prev.summary.rows)} {zh ? '列' : 'rows'}</div></div>
            {summary && <div className="row">
              <span className="tag wine">{num(summary.wines)} {zh ? '款' : 'wines'}{summary.newWines !== summary.wines ? ` (${zh ? '新' : 'new'} ${summary.newWines})` : ''}</span>
              <span className="tag wine">{num(summary.cases)} {zh ? '箱' : 'cases'}</span>
              <span className="tag wine">{num(summary.bottles)} {zh ? '瓶' : 'bottles'}</span>
              <span className="tag wine">{num(summary.prices)} {zh ? '筆價格' : 'prices'}</span>
            </div>}
          </div>
          {prev.suggestions.length > 0 && (
            <div className="card">
              <h2>{zh ? '名稱合併' : 'Merge names'}</h2>
              <div className="muted small" style={{ marginBottom: 10 }}>{zh ? '勾選的會合併成右邊的名稱。只差大小寫、重音或已確認的已預先勾選；拼字相近的請自行判斷。' : 'Checked rows are merged into the name on the right. Case/accent-only differences are pre-checked.'}</div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th style={{ width: 40 }}></th><th>{zh ? '欄位' : 'Field'}</th><th>{zh ? '原名稱' : 'From'}</th><th>{zh ? '合併為' : 'Into'}</th><th>{zh ? '原因' : 'Why'}</th></tr></thead>
                <tbody>{prev.suggestions.map((s, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" style={{ width: 18, height: 18, accentColor: 'var(--wine)' }} checked={!!picked[i]} onChange={(e) => setPicked({ ...picked, [i]: e.target.checked })} aria-label={`${s.from} → ${s.to}`} /></td>
                    <td>{L(FIELD[s.field])}</td><td>{s.from} <span className="muted small">({s.fromCount})</span></td><td><b>{s.to}</b>{s.toCount ? <span className="muted small"> ({s.toCount})</span> : null}</td>
                    <td>{s.kind === 'similar' ? <span className="tag warn">{zh ? '拼字相近' : 'Similar'}</span> : s.kind === 'synonym' ? <span className="tag">{zh ? '同義' : 'Synonym'}</span> : s.kind === 'confirmed' ? <span className="tag ok">{zh ? '已確認' : 'Confirmed'}</span> : <span className="tag ok">{zh ? '大小寫／重音' : 'Case/accent'}</span>}</td>
                  </tr>))}</tbody>
              </table></div>
            </div>)}
          {prev.issues.length > 0 && (
            <div className="card">
              <h2>{zh ? '需要注意' : 'Things to note'}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{prev.issues.map((x, i) => (
                <div key={i} className={'alert' + (x.blocking ? ' err' : '')}><b>{x.message}</b><div className="small">→ {x.fix}</div></div>
              ))}</div>
            </div>)}
          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{zh ? '資料預覽（前 15 列）' : 'Preview (first 15 rows)'}</summary>
            <div className="tbl-wrap" style={{ marginTop: 12 }}><table className="tbl">
              <thead><tr><th>#</th><th>{t('cellar')}</th><th>{t('locker')}</th><th>{t('caseNo')}</th><th>{t('winery')}</th><th>{t('name')}</th><th>{t('vintage')}</th><th>{t('type')}</th><th className="num">{t('qty')}</th><th>{t('merchant')}</th><th className="num">{t('cost')}</th><th className="num">{t('market')}</th></tr></thead>
              <tbody>{prev.sample.map((r) => <tr key={r.line}><td className="muted">{r.line}</td><td>{r.cellar}</td><td>{r.locker}{r.uncertain ? '?' : ''}</td><td>{r.caseNo}</td><td>{r.winery}</td><td>{r.name}</td><td>{r.vintage}</td><td>{r.type}</td><td className="num">{r.qty}</td><td>{r.merchant}</td><td className="num">{num(r.cost)}</td><td className="num">{num(r.market)}</td></tr>)}</tbody>
            </table></div>
          </details>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={reset} disabled={busy}>{zh ? '取消' : 'Cancel'}</button>
            <button className="btn primary" onClick={commit} disabled={busy}>{busy ? t('loading') : zh ? `確認匯入 ${summary ? num(summary.bottles) : ''} 瓶` : `Import ${summary ? num(summary.bottles) : ''} bottles`}</button>
          </div>
        </>
      )}

      {step === 3 && result && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="alert ok"><b>{zh ? '匯入完成' : 'Import complete'}</b> · {result.batchId}</div>
          <div className="row">
            <span className="tag wine">{num(result.wines)} {zh ? '款' : 'wines'}</span><span className="tag wine">{num(result.cases)} {zh ? '箱' : 'cases'}</span>
            <span className="tag wine">{num(result.bottles)} {zh ? '瓶' : 'bottles'}</span><span className="tag wine">{num(result.prices)} {zh ? '筆價格' : 'prices'}</span>
          </div>
          {result.skipped.length > 0 && <div className="alert">{zh ? '略過：' : 'Skipped: '}{result.skipped.map((s) => s.reason).join('、')}</div>}
          <div className="row"><Link className="btn primary" to="/search">{zh ? '查看庫存' : 'View stock'}</Link><Link className="btn" to={'/audit?q=' + result.batchId}>{t('audit')}</Link><button className="btn" onClick={reset}>{zh ? '再匯入一個檔案' : 'Import another file'}</button></div>
        </div>
      )}

      {history.data?.length > 0 && (
        <div className="card">
          <h2>{zh ? '匯入紀錄' : 'Import history'}</h2>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>{zh ? '批次' : 'Batch'}</th><th>{zh ? '檔案' : 'File'}</th><th>{t('by')}</th><th>{t('time')}</th><th>{zh ? '內容' : 'Contents'}</th></tr></thead>
            <tbody>{history.data.map((b) => <tr key={b.id}><td>{b.id}</td><td>{b.filename}</td><td>{b.created_by}</td><td className="muted">{b.created_at}</td><td className="small">{['wines', 'cases', 'bottles', 'prices', 'skipped'].map((k) => `${(zh ? { wines: '酒款', cases: '酒箱', bottles: '瓶', prices: '價格', skipped: '略過' } : {})[k] || k} ${b.summary[k] ?? 0}`).join(' · ')}</td></tr>)}</tbody>
          </table></div>
        </div>)}
    </div>
  );
}
