import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, num } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { QR, run } from '../ui.jsx';
import { handoff, receive } from '../handoff.js';

export const qrValue = (kind, x) => (kind === 'bottle' ? x.bottle_no : kind === 'case' ? 'CASE:' + x.case_no : kind === 'locker' ? 'LOCKER:' + x.id : 'RACK:' + x.id);
export const labelKey = (kind, x) => (kind === 'bottle' ? x.bottle_no : kind === 'case' ? x.case_no : String(x.id));

// 標籤尺寸（mm）：字體與 QR Code 依高度等比例縮放
export const parseSize = (s, def) => { const m = /^(\d+)x(\d+)$/.exec(s || ''); return m ? { w: +m[1], h: +m[2] } : def; };
export const DEF_SIZE = { bottle: { w: 62, h: 29 }, big: { w: 100, h: 62 } };
const sizeStyle = (sz, base) => ({ width: sz.w + 'mm', height: sz.h + 'mm', '--s': Math.min(sz.h / base.h, sz.w / base.w * 1.15, 1.6).toFixed(3) });

export function Label({ kind, x, size }) {
  const big = kind !== 'bottle';
  const sz = size || (big ? DEF_SIZE.big : DEF_SIZE.bottle);
  const st = sizeStyle(sz, big ? DEF_SIZE.big : DEF_SIZE.bottle);
  const tall = big && sz.h >= sz.w * 0.8; // 方形或直式：QR Code 放下方
  const qr = (tall ? Math.min(sz.w - 8, sz.h * 0.5) : big ? Math.min(sz.h - 8, sz.w * 0.45) : Math.min(sz.h - 4, sz.w * 0.42)).toFixed(1) + 'mm';
  const cls = 'lbl big' + (tall ? ' tall' : '');
  if (kind === 'bottle') return (
    <div className="lbl bottle" style={st}><QR value={qrValue(kind, x)} size={qr} /><div className="t">
      <span className="no">{x.bottle_no}</span><span className="nm">{x.name}</span><span className="sm">{x.vintage} · {x.volume_ml} ml</span></div></div>
  );
  if (kind === 'case') return (
    <div className={cls} style={st}><div className="t">
      <span className="hd">酒箱 CASE</span><span className="no">{x.case_no}</span><span className="nm">{x.name}</span>
      <span className="sm">{x.vintage} · {x.qty}{x.capacity ? '/' + x.capacity : ''} 瓶</span>
      {x.first && <span className="sm">{x.first}{x.last !== x.first ? ' – ' + x.last.slice(-4) : ''}</span>}<span className="sm" style={{ marginTop: 'auto' }}>{x.location}</span></div>
      <QR value={qrValue(kind, x)} size={qr} /></div>
  );
  return (
    <div className={cls} style={st}><div className="t">
      <span className="hd">{kind === 'locker' ? '分儲空間 LOCKER' : '架子 RACK'}</span>
      <span className="sm" style={{ fontSize: 'calc(12pt * var(--s, 1))' }}>{x.cellar}{kind === 'rack' ? ' › ' + x.locker : ''}</span>
      <span className="no" style={{ fontSize: 'calc(30pt * var(--s, 1))' }}>{x.code}</span></div>
      <QR value={qrValue(kind, x)} size={qr} /></div>
  );
}

const KINDS = [['bottle', '酒瓶小標', 'Bottle'], ['case', '酒箱', 'Case'], ['locker', '分儲空間', 'Locker'], ['rack', '架子', 'Rack']];
const PRESETS = {
  bottle: ['62x29', '50x30', '60x40', '70x40', '40x30'],
  big: ['100x62', '100x60', '100x100', '100x150', '80x50'],
};
const fmt = (s) => s.replace('x', ' × ') + ' mm';

export default function Labels() {
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const init = useMemo(() => receive(sp.get('k')) || {}, [sp]);
  const [kind, setKind] = useState(init.kind || 'bottle');
  const [src, setSrc] = useState(init.kind ? init : { unprinted: true });
  const [onlyNew, setOnlyNew] = useState(false);
  const [labels, setLabels] = useState(null);
  const [lockerSel, setLockerSel] = useState([]);
  const { data: lists } = useApi('/api/lists');
  const { data: locs } = useApi('/api/locations');
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api('/api/settings').then((x) => setCfg(x.label)).catch(() => setCfg(null)); }, []);
  const grp = kind === 'bottle' ? 'bottle' : 'big';
  const sizeStr = cfg ? cfg[grp + '_size'] : (grp === 'bottle' ? '62x29' : '100x62');
  const size = parseSize(sizeStr, DEF_SIZE[grp]);
  const [custom, setCustom] = useState(false);
  const saveCfg = async (patch) => { const r = await run(() => api('/api/settings/label', { method: 'PUT', body: { ...cfg, ...patch } })); if (r) setCfg(r.label); };

  useEffect(() => {
    let body;
    if (kind === 'bottle') body = { kind, ...(src.unprinted ? { unprinted: true } : src), only_unprinted: onlyNew };
    else if (kind === 'case') body = { kind, ...(src.unprinted ? { query: {} } : src) };
    else body = { kind, [kind + '_ids']: lockerSel };
    if ((kind === 'locker' || kind === 'rack') && !lockerSel.length) { setLabels([]); return; }
    setLabels(null);
    api('/api/labels', { method: 'POST', body: { ...body, kind } }).then((r) => setLabels(r.labels)).catch(() => setLabels([]));
  }, [kind, src, onlyNew, lockerSel]);

  const srcLabel = src.unprinted ? (zh ? '所有未列印的瓶號' : 'All unprinted bottles') : src.list ? (zh ? '清單：' : 'List: ') + (lists?.find((l) => String(l.id) === String(src.list))?.name || src.title || '')
    : src.bottle_nos ? (zh ? `指定的 ${src.bottle_nos.length} 瓶` : `${src.bottle_nos.length} selected bottles`) : src.case_nos ? (zh ? '酒箱 ' : 'Cases ') + src.case_nos.join('、') : src.query ? (zh ? '搜尋結果' : 'Search results') : '';
  const rackOptions = locs ? locs.flatMap((c) => c.lockers.map((l) => ({ c, l }))) : [];
  const print = () => nav('/print/labels?k=' + handoff({ kind, labels, size }));

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>{zh ? '標籤列印' : 'Labels'}</h1>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{zh ? '標籤類型' : 'Label type'}</h2>
            <div className="radio-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>{KINDS.map(([k, a, b]) => (
              <label key={k} className={kind === k ? 'on' : ''}><input type="radio" checked={kind === k} onChange={() => { setKind(k); setLockerSel([]); }} /><span>{zh ? a : b}<div className="muted small">{fmt(cfg ? cfg[(k === 'bottle' ? 'bottle' : 'big') + '_size'] : (k === 'bottle' ? '62x29' : '100x62'))}</div></span></label>
            ))}</div>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{zh ? '要列印的項目' : 'What to print'}</h2>
            {(kind === 'bottle' || kind === 'case') ? (
              <>
                <div className="alert" style={{ background: 'var(--ground)', color: 'var(--ink)' }}>{srcLabel}</div>
                <div className="row">
                  {kind === 'bottle' && <button className="btn mini" onClick={() => setSrc({ unprinted: true })}>{zh ? '所有未列印的瓶號' : 'All unprinted'}</button>}
                  <select className="input" style={{ width: 'auto', minHeight: 32 }} value="" onChange={(e) => e.target.value && setSrc({ list: e.target.value })}>
                    <option value="">{zh ? '從清單加入…' : 'From a list…'}</option>{lists?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                  <Link className="btn mini" to="/search">{zh ? '從搜尋結果加入' : 'From search'}</Link>
                </div>
                {kind === 'bottle' && !src.unprinted && <label className="check"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />{zh ? '只印尚未列印過的' : 'Only bottles never printed'}</label>}
              </>
            ) : (
              <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                <label className="check"><input type="checkbox" checked={kind === 'locker' ? lockerSel.length === rackOptions.length : lockerSel.length === rackOptions.flatMap((o) => o.l.racks).length}
                  onChange={(e) => setLockerSel(e.target.checked ? (kind === 'locker' ? rackOptions.map((o) => o.l.id) : rackOptions.flatMap((o) => o.l.racks.map((r) => r.id))) : [])} /><b>{zh ? '全選' : 'All'}</b></label>
                {rackOptions.map(({ c, l }) => kind === 'locker'
                  ? <label className="check" key={l.id}><input type="checkbox" checked={lockerSel.includes(l.id)} onChange={() => setLockerSel(lockerSel.includes(l.id) ? lockerSel.filter((x) => x !== l.id) : [...lockerSel, l.id])} />{c.name} › {l.code}</label>
                  : l.racks.map((r) => <label className="check" key={r.id}><input type="checkbox" checked={lockerSel.includes(r.id)} onChange={() => setLockerSel(lockerSel.includes(r.id) ? lockerSel.filter((x) => x !== r.id) : [...lockerSel, r.id])} />{c.name} › {l.code} › {r.code}</label>))}
              </div>
            )}
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{zh ? '印表機與標籤尺寸' : 'Printer & label size'}</h2>
            <label className="f">{zh ? '標籤印表機' : 'Label printer'}
              <input className="input" defaultValue={cfg?.printer || ''} key={cfg?.printer} onBlur={(e) => e.target.value.trim() !== (cfg?.printer || '') && saveCfg({ printer: e.target.value.trim() })} /></label>
            <label className="f">{kind === 'bottle' ? (zh ? '酒瓶小標尺寸（寬 × 高）' : 'Bottle label size (W × H)') : (zh ? '酒箱／分儲空間／架子標籤尺寸（寬 × 高）' : 'Case / locker / rack label size (W × H)')}
              <select className="input" value={custom || !PRESETS[grp].includes(sizeStr) ? 'custom' : sizeStr} onChange={(e) => { if (e.target.value === 'custom') setCustom(true); else { setCustom(false); saveCfg({ [grp + '_size']: e.target.value }); } }}>
                {PRESETS[grp].map((p) => <option key={p} value={p}>{fmt(p)}</option>)}
                <option value="custom">{zh ? '自訂尺寸…' : 'Custom…'}</option>
              </select></label>
            {(custom || !PRESETS[grp].includes(sizeStr)) && (
              <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.target); saveCfg({ [grp + '_size']: `${Math.round(f.get('w'))}x${Math.round(f.get('h'))}` }); setCustom(false); }}>
                <input className="input" name="w" type="number" min="20" max="200" defaultValue={size.w} aria-label="width mm" />×
                <input className="input" name="h" type="number" min="15" max="200" defaultValue={size.h} aria-label="height mm" />mm
                <button className="btn mini">{zh ? '套用' : 'Apply'}</button></form>)}
            <div className="small">{zh ? <>按「列印」後，在列印視窗選 <b>{cfg?.printer || 'TSC TTP-247'}</b>，紙張選 <b>{fmt(sizeStr)}</b>，邊界選「無」。瀏覽器不能替你選印表機；把它設為電腦的預設印表機後，就不用每次選（見下方）。</> : <>In the print dialog choose <b>{cfg?.printer || 'TSC TTP-247'}</b>, paper <b>{fmt(sizeStr)}</b>, margins none. Browsers can't pick the printer for you; make it the computer's default printer.</>}</div>
            <details className="small"><summary>{zh ? '把標籤印表機設為預設印表機' : 'Make it the default printer'}</summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li>{zh ? 'Windows：設定 › 藍牙與裝置 › 印表機與掃描器，關閉「讓 Windows 管理預設印表機」，點這台印表機 › 設為預設。' : 'Windows: Settings › Bluetooth & devices › Printers & scanners, turn off "Let Windows manage my default printer", click the printer › Set as default.'}</li>
                <li>{zh ? 'Mac：系統設定 › 印表機與掃描器 › 預設印表機，選這台。' : 'Mac: System Settings › Printers & Scanners › Default printer.'}</li>
                <li>{zh ? '在印表機的「列印喜好設定」把紙張（Stock）設成和這裡相同的尺寸，印出來才不會偏移或多跳一張。' : 'In the printer\'s Printing Preferences, set the stock size to the same size so labels don\'t shift or skip.'}</li>
              </ul></details>
            <div className="small muted">{zh ? '要存成 PDF：在列印視窗的印表機選「另存為 PDF」。' : 'For a PDF, choose “Save as PDF” in the print dialog.'}</div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <span className="muted">{labels ? (zh ? `共 ${num(labels.length)} 張` : `${num(labels.length)} labels`) : '…'}</span>
            <button className="btn primary" disabled={!labels?.length} onClick={print}>{zh ? `列印 ${labels ? num(labels.length) : ''} 張` : `Print ${labels ? num(labels.length) : ''}`}</button>
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>{zh ? '預覽（實際尺寸比例）' : 'Preview (actual size)'}</h2>
          {kind === 'bottle' && <div className="muted small">{zh ? '小尺寸預切標籤，貼在瓶頸或背標旁，不遮住酒標。' : 'Small label for the neck or back, never over the front label.'}</div>}
          <div className="label-preview">{labels?.slice(0, 12).map((x) => <Label key={labelKey(kind, x)} kind={kind} x={x} size={size} />)}</div>
          {labels?.length > 12 && <div className="muted small">{zh ? `…還有 ${labels.length - 12} 張` : `…and ${labels.length - 12} more`}</div>}
          {labels && !labels.length && <div className="muted">{zh ? '沒有要列印的標籤' : 'Nothing to print'}</div>}
        </div>
      </div>
    </div>
  );
}
