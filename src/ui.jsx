import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from './api.js';

export const toast = (msg, kind = 'ok') => window.dispatchEvent(new CustomEvent('mywines:toast', { detail: { msg, kind } }));

export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const id = Math.random();
      setList((l) => [...l, { id, ...e.detail }]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), e.detail.kind === 'err' ? 6000 : 3500);
    };
    window.addEventListener('mywines:toast', on);
    return () => window.removeEventListener('mywines:toast', on);
  }, []);
  return <div className="toasts" role="status" aria-live="polite">{list.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}</div>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 只在開啟時把游標放到第一個欄位一次。onClose 每次重畫都是新函式，
  // 不能放進相依清單，否則每打一個字游標就跳回第一個欄位。
  useEffect(() => {
    (ref.current?.querySelector('.modal-body input, .modal-body select, .modal-body textarea') || ref.current)?.focus();
    const k = (e) => e.key === 'Escape' && closeRef.current?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="row between modal-head"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn ghost" onClick={onClose} aria-label="關閉">×</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="row modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// 密碼欄：右邊的眼睛按鈕可顯示／隱藏密碼
export function PasswordInput({ zh = true, className = 'input', style, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap" style={style}>
      <input {...props} className={className} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-eye" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setShow(!show)}
        aria-label={show ? (zh ? '隱藏密碼' : 'Hide password') : (zh ? '顯示密碼' : 'Show password')} title={show ? (zh ? '隱藏密碼' : 'Hide password') : (zh ? '顯示密碼' : 'Show password')}>
        {show
          ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l18 18M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.2 6.2C4 7.6 2.6 9.8 2 12c1 2.5 5 7 10 7 1.7 0 3.3-.5 4.6-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
          : <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></svg>}
      </button>
    </span>
  );
}

export function QR({ value, size = 64 }) {
  const [svg, setSvg] = useState('');
  useEffect(() => { QRCode.toString(String(value), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg('')); }, [value]);
  return <span className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} aria-label={'QR ' + value} />;
}

// 呼叫 API，錯誤自動顯示
export async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message, 'err'); throw e; }
}

export async function download(url, body, fallbackName) {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || res.statusText); }
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// 儲位選擇：酒窖 › 分儲空間 › 架子
export function RackPicker({ value, onChange, zh, allowNew = true }) {
  const [locs, setLocs] = useState(null);
  const [cellar, setCellar] = useState('');
  const [locker, setLocker] = useState('');
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const load = () => api('/api/locations').then(setLocs);
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!locs || !value) return;
    for (const c of locs) for (const l of c.lockers) if (l.racks.some((r) => r.id === Number(value))) { setCellar(String(c.id)); setLocker(String(l.id)); }
  }, [locs, value]);
  if (!locs) return <div className="muted">…</div>;
  const c = locs.find((x) => String(x.id) === cellar) || (locs.length === 1 ? locs[0] : null);
  const l = c?.lockers.find((x) => String(x.id) === locker);
  const addRack = async () => {
    const r = await run(() => api('/api/racks', { method: 'POST', body: { locker_id: l.id, code } }), zh ? '已新增架子' : 'Rack added');
    setAdding(false); setCode(''); await load(); onChange(r.id);
  };
  return (
    <div className="grid g3" style={{ gap: 10 }}>
      <label className="f">{zh ? '酒窖' : 'Cellar'}<select className="input" value={c ? String(c.id) : ''} onChange={(e) => { setCellar(e.target.value); setLocker(''); onChange(''); }}>
        <option value="">—</option>{locs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="f">{zh ? '分儲空間' : 'Locker'}<select className="input" value={locker} onChange={(e) => {
        setLocker(e.target.value);
        const nl = c?.lockers.find((x) => String(x.id) === e.target.value);
        onChange(nl?.racks.length === 1 ? nl.racks[0].id : '');
      }} disabled={!c}>
        <option value="">—</option>{c?.lockers.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></label>
      <label className="f">{zh ? '架子' : 'Rack'}
        {!adding ? (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select className="input" value={value || ''} onChange={(e) => onChange(Number(e.target.value) || '')} disabled={!l}>
              <option value="">—</option>{l?.racks.map((r) => <option key={r.id} value={r.id}>{r.code}（{r.n} {zh ? '瓶' : 'btl'}）</option>)}
            </select>
            {allowNew && l && <button type="button" className="btn" onClick={() => setAdding(true)} title={zh ? '新增架子' : 'Add rack'}>＋</button>}
          </div>
        ) : (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder={zh ? '架子名稱，例 上層' : 'e.g. Top'} autoFocus />
            <button type="button" className="btn primary" disabled={!code.trim()} onClick={addRack}>{zh ? '新增' : 'Add'}</button>
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>×</button>
          </div>
        )}
      </label>
    </div>
  );
}

// 代碼輸入：可貼上多個（空白、逗號、換行分隔），按 Enter 加入
export function CodeInput({ onCodes, placeholder, zh }) {
  const [v, setV] = useState('');
  const add = () => { const codes = v.split(/[\s,，]+/).map((x) => x.trim()).filter(Boolean); if (codes.length) onCodes(codes); setV(''); };
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} autoCapitalize="characters" />
      <button type="button" className="btn" onClick={add}>{zh ? '加入' : 'Add'}</button>
    </div>
  );
}
