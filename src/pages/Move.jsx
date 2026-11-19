import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import { CodeInput, RackPicker, run, toast } from '../ui.jsx';
import { receive } from '../handoff.js';

export default function Move() {
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const init = receive(sp.get('k'));
  const [tab, setTab] = useState(sp.get('case') ? 'case' : init?.what === 'bottles' ? 'bottles' : 'case');
  const what = tab === 'case' ? 'case' : 'bottles';
  const [caseNo, setCaseNo] = useState(sp.get('case') || '');
  const [caseInfo, setCaseInfo] = useState(null);
  const [bottles, setBottles] = useState([]); // [{bottle_no, name, vintage, case_no, label}]
  const [dest, setDest] = useState({ mode: 'loose', rack_id: '', case_no: '', capacity: 6 });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (init?.bottle_nos) addCodes(init.bottle_nos); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (what !== 'case' || !caseNo) { setCaseInfo(null); return; }
    const tm = setTimeout(() => api('/api/cases/' + encodeURIComponent(caseNo)).then(setCaseInfo).catch(() => setCaseInfo(false)), 250);
    return () => clearTimeout(tm);
  }, [what, caseNo]);

  async function addCodes(codes) {
    const found = [];
    for (const c of codes) {
      try {
        const r = await api('/api/resolve/' + encodeURIComponent(c));
        if (r.type === 'bottle') {
          if (r.status !== 'in_stock') toast(`${r.bottle_no} ${zh ? '不在庫' : 'not in stock'}`, 'err');
          else found.push(r);
        } else if (r.type === 'case') found.push(...r.bottles.map((b) => ({ ...b, case_no: r.case_no, label: r.label })));
        else toast(zh ? `「${c}」不是瓶號或箱號` : `"${c}" is not a bottle or case`, 'err');
      } catch (e) { toast(e.message, 'err'); }
    }
    setBottles((cur) => { const have = new Set(cur.map((b) => b.bottle_no)); return [...cur, ...found.filter((b) => !have.has(b.bottle_no) && have.add(b.bottle_no))]; });
  }
  async function scanDest(codes) {
    try {
      const r = await api('/api/resolve/' + encodeURIComponent(codes[0]));
      if (r.type === 'rack') setDest({ ...dest, rack_id: r.id, mode: dest.mode === 'case' ? 'loose' : dest.mode });
      else if (r.type === 'case' && what !== 'case') setDest({ ...dest, mode: 'case', case_no: r.case_no });
      else toast(zh ? '請掃描架子' + (what !== 'case' ? '或酒箱' : '') : 'Scan a rack' + (what !== 'case' ? ' or case' : ''), 'err');
    } catch (e) { toast(e.message, 'err'); }
  }

  const fromCases = [...new Set(bottles.map((b) => b.case_no || (zh ? '散瓶' : 'loose')))];
  const ready = what === 'case' ? caseInfo && dest.rack_id : bottles.length && (dest.mode === 'case' ? dest.case_no : dest.rack_id);
  const submit = async () => {
    setBusy(true);
    try {
      const body = what === 'case' ? { what, case_no: caseNo, dest: { rack_id: dest.rack_id }, note } : { what: 'bottles', bottle_nos: bottles.map((b) => b.bottle_no), dest, note };
      const r = await run(() => api('/api/move', { method: 'POST', body }), (r) => (zh ? `已移動 ${r.moved} 瓶到 ${r.case_no ? '酒箱 ' + r.case_no + ' @ ' : ''}${r.to}` : `Moved ${r.moved} bottles`));
      if (r.warning) toast(r.warning, 'err');
      nav(r.case_no ? '/cases/' + encodeURIComponent(r.case_no) : what === 'case' ? '/cases/' + encodeURIComponent(caseNo) : -1);
    } catch { /* */ } finally { setBusy(false); }
  };
  const tabs = [['case', zh ? '整箱' : 'Whole case'], ['bottles', zh ? '部分酒瓶' : 'Some bottles'], ['loose', zh ? '散瓶裝箱' : 'Box loose bottles']];

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="crumbs"><Link to="/storage">{zh ? '儲位' : 'Storage'}</Link>›<span>{zh ? '移動 / 調撥' : 'Move'}</span></div>
      <h1>{zh ? '移動 / 調撥' : 'Move'}</h1>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>{zh ? '1. 移動什麼' : '1. What to move'}</h2>
        <div className="seg">{tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setDest({ ...dest, mode: k === 'loose' ? 'newcase' : 'loose' }); }}>{l}</button>
        ))}</div>
        {what === 'case' ? (
          <>
            <label className="f">{zh ? '箱號（輸入或掃描）' : 'Case no. (type or scan)'}<input className="input" value={caseNo} onChange={(e) => setCaseNo(e.target.value.trim())} placeholder="04-28-22-01" autoFocus /></label>
            {caseInfo && (
              <div className="alert ok" style={{ background: 'var(--ground)', color: 'var(--ink)' }}>
                <b>{caseInfo.case.case_no}</b> · {[...new Set(caseInfo.bottles.map((b) => b.name))].join('、')} · {caseInfo.bottles.filter((b) => b.status === 'in_stock').length} {zh ? '瓶' : 'btl'}
                <div className="small muted">{zh ? '目前' : 'Now'}：{caseInfo.case.cellar} › {caseInfo.case.locker} › {caseInfo.case.rack}{caseInfo.case.location_uncertain ? (zh ? '（待確認）' : ' (to confirm)') : ''}</div>
              </div>
            )}
            {caseInfo === false && <div className="alert err">{zh ? '找不到這個箱號' : 'Case not found'}</div>}
          </>
        ) : (
          <>
            <CodeInput zh={zh} onCodes={addCodes} placeholder={zh ? '掃描或輸入瓶號；輸入箱號會加入整箱酒瓶' : 'Scan or type bottle no.; a case no. adds all its bottles'} />
            {bottles.length > 0 && (
              <>
                <div className="chips">{bottles.map((b) => <span className="chip" key={b.bottle_no} title={`${b.name} ${b.vintage}`}>{b.bottle_no}<button onClick={() => setBottles(bottles.filter((x) => x.bottle_no !== b.bottle_no))} aria-label={zh ? '移除' : 'Remove'}>×</button></span>)}</div>
                <div className="muted small">{zh ? `已選 ${bottles.length} 瓶，來自：${fromCases.join('、')}。系統會自動拆分庫存。` : `${bottles.length} bottles from ${fromCases.join(', ')}.`}</div>
              </>
            )}
            {tab === 'loose' && <div className="muted small">{zh ? '掃描要裝箱的散瓶，可混裝不同酒款；箱內總瓶數超過容量時會提醒。' : 'Scan loose bottles to box together; mixing wines is fine.'}</div>}
          </>
        )}
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>{zh ? '2. 移到哪裡' : '2. Where to'}</h2>
        {what === 'bottles' && (
          <div className="radio-cards">{[['case', zh ? '放入現有酒箱' : 'Into existing case'], ['newcase', zh ? '建立新酒箱' : 'Into a new case'], ['loose', zh ? '散瓶放架子上' : 'Loose on a rack']].map(([m, l]) => (
            <label key={m} className={dest.mode === m ? 'on' : ''}><input type="radio" checked={dest.mode === m} onChange={() => setDest({ ...dest, mode: m })} />{l}</label>
          ))}</div>
        )}
        {what === 'bottles' && dest.mode === 'case'
          ? <label className="f">{zh ? '目的地箱號' : 'Destination case'}<input className="input" value={dest.case_no} onChange={(e) => setDest({ ...dest, case_no: e.target.value.trim() })} /></label>
          : <RackPicker value={dest.rack_id} onChange={(v) => setDest({ ...dest, rack_id: v })} zh={zh} />}
        {what === 'bottles' && dest.mode === 'newcase' && (
          <div className="grid g2" style={{ gap: 10 }}>
            <label className="f">{zh ? '新箱號（留空自動編號）' : 'New case no. (blank = auto)'}<input className="input" value={dest.case_no} onChange={(e) => setDest({ ...dest, case_no: e.target.value.trim() })} /></label>
            <label className="f">{zh ? '容量（瓶）' : 'Capacity'}<input className="input" inputMode="numeric" value={dest.capacity} onChange={(e) => setDest({ ...dest, capacity: e.target.value })} /></label>
          </div>
        )}
        <div className="muted small">{zh ? '或直接掃描目的地的架子' + (what === 'bottles' ? '、酒箱' : '') + ' QR Code：' : 'Or scan the destination QR code:'}</div>
        <CodeInput zh={zh} onCodes={scanDest} placeholder="RACK:12 / 12-06-23-07" />
        <label className="f">{zh ? '備註（選填）' : 'Note (optional)'}<input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <span className="muted small">{zh ? '將記入異動紀錄' : 'Will be logged'}</span>
        <button className="btn" onClick={() => nav(-1)}>{zh ? '取消' : 'Cancel'}</button>
        <button className="btn primary" disabled={!ready || busy} onClick={submit}>{zh ? '確認移動' : 'Move'}</button>
      </div>
    </div>
  );
}
