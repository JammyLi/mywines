import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, num } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { QR, run } from '../ui.jsx';
import { handoff, receive } from '../handoff.js';

export const qrValue = (kind, x) => (kind === 'bottle' ? x.bottle_no : kind === 'case' ? 'CASE:' + x.case_no : kind === 'locker' ? 'LOCKER:' + x.id : 'RACK:' + x.id);
export const labelKey = (kind, x) => (kind === 'bottle' ? x.bottle_no : kind === 'case' ? x.case_no : String(x.id));

export function Label({ kind, x }) {
  if (kind === 'bottle') return (
    <div className="lbl bottle"><QR value={qrValue(kind, x)} size={90} /><div className="t">
      <span className="no">{x.bottle_no}</span><span className="nm">{x.name}</span><span className="sm">{x.vintage} · {x.volume_ml} ml</span></div></div>
  );
  if (kind === 'case') return (
    <div className="lbl big"><div className="t">
      <span className="hd">酒箱 CASE</span><span className="no">{x.case_no}</span><span className="nm">{x.name}</span>
      <span className="sm">{x.vintage} · {x.qty}{x.capacity ? '/' + x.capacity : ''} 瓶</span>
      {x.first && <span className="sm">{x.first}{x.last !== x.first ? ' – ' + x.last.slice(-4) : ''}</span>}<span className="sm" style={{ marginTop: 'auto' }}>{x.location}</span></div>
      <QR value={qrValue(kind, x)} size={170} /></div>
  );
  return (
    <div className="lbl big"><div className="t">
      <span className="hd">{kind === 'locker' ? '分儲空間 LOCKER' : '架子 RACK'}</span>
      <span className="sm" style={{ fontSize: '12pt' }}>{x.cellar}{kind === 'rack' ? ' › ' + x.locker : ''}</span>
      <span className="no" style={{ fontSize: '30pt' }}>{x.code}</span></div>
      <QR value={qrValue(kind, x)} size={170} /></div>
  );
}

const KINDS = [['bottle', '酒瓶小標', 'Bottle', '29 × 62 mm'], ['case', '酒箱', 'Case', '62 × 100 mm'], ['locker', '分儲空間', 'Locker', '62 × 100 mm'], ['rack', '架子', 'Rack', '62 × 100 mm']];

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
  const print = () => nav('/print/labels?k=' + handoff({ kind, labels }));

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>{zh ? '標籤列印' : 'Labels'}</h1>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{zh ? '標籤類型' : 'Label type'}</h2>
            <div className="radio-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>{KINDS.map(([k, a, b, size]) => (
              <label key={k} className={kind === k ? 'on' : ''}><input type="radio" checked={kind === k} onChange={() => { setKind(k); setLockerSel([]); }} /><span>{zh ? a : b}<div className="muted small">{size}</div></span></label>
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
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2>{zh ? '印表機' : 'Printer'}</h2>
            <div className="small">{zh ? '建議 Brother QL-820NWB（內網）。按「列印」後在列印視窗選這台印表機；紙張選 62 mm 連續標籤或對應尺寸的預切標籤，邊界選「無」。' : 'Recommended: Brother QL-820NWB on the office network. Choose it in the print dialog with 62 mm tape and no margins.'}</div>
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
          <div className="label-preview">{labels?.slice(0, 12).map((x) => <Label key={labelKey(kind, x)} kind={kind} x={x} />)}</div>
          {labels?.length > 12 && <div className="muted small">{zh ? `…還有 ${labels.length - 12} 張` : `…and ${labels.length - 12} more`}</div>}
          {labels && !labels.length && <div className="muted">{zh ? '沒有要列印的標籤' : 'Nothing to print'}</div>}
        </div>
      </div>
    </div>
  );
}
