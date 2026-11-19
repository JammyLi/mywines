import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ntd } from '../api.js';
import { useT } from '../i18n.jsx';
import { Modal, toast } from '../ui.jsx';
import { queueOp, sync, refreshSnapshot, useOffline, clearLocal } from '../offline/store.js';
import Scanner from './Scanner.jsx';
import { ReasonPicker } from '../pages/dialogs.jsx';
import { useSnap, SyncPill, MHead, resolveLocal, rackLabel, ManualInput, describeOp } from './common.jsx';

const useZh = () => useT().lang !== 'en';
const recentKey = 'recentScans';
const pushRecent = (code) => { try { const r = JSON.parse(localStorage.getItem(recentKey) || '[]').filter((x) => x !== code); r.unshift(code); localStorage.setItem(recentKey, JSON.stringify(r.slice(0, 8))); } catch { /* */ } };
const getRecent = () => { try { return JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch { return []; } };
const STATUS_ZH = { in_stock: '在庫', reserved: '保留', broken: '破損', shipped: '已出貨', out: '已出庫' };

function NoData({ zh }) {
  const st = useOffline();
  return <div className="card">{st.online ? (zh ? '正在下載資料…' : 'Downloading data…') : (zh ? '手機上還沒有資料。請先連上公司 Wi-Fi 開啟一次，系統會自動下載。' : 'No data on this phone yet. Open once on the office Wi-Fi.')}</div>;
}

// ===== 掃描首頁 =====
export function MHome() {
  const zh = useZh();
  const nav = useNavigate();
  const [s] = useSnap();
  const [msg, setMsg] = useState(null);
  const go = (code) => {
    if (!s) return;
    const r = resolveLocal(s, code);
    if (!r) { setMsg({ kind: 'err', text: (zh ? '找不到：' : 'Not found: ') + code }); return; }
    pushRecent(code);
    if (r.type === 'bottle') nav('/m/b/' + r.bottle_no);
    else if (r.type === 'case') nav('/m/c/' + encodeURIComponent(r.case_no));
    else if (r.type === 'locker') nav('/m/l/' + r.id);
    else if (r.type === 'rack') nav('/m/l/' + r.rack.locker_id);
    else if (r.type === 'wine') nav('/m/w/' + r.wine_no);
  };
  const recent = getRecent().map((c) => (s ? [c, resolveLocal(s, c)] : [c, null])).filter(([, r]) => r);
  return (
    <div className="mpage">
      <MHead title={zh ? '掃描' : 'Scan'} back={null} right={<SyncPill zh={zh} />} />
      <div className="modes">
        <Link to="/m" className="on">{zh ? '查詢' : 'Look up'}</Link>
        <Link to="/m/move">{zh ? '移動' : 'Move'}</Link>
        <Link to="/m/list">{zh ? '建立清單' : 'List'}</Link>
        <Link to="/m/count">{zh ? '盤點' : 'Count'}</Link>
      </div>
      {!s ? <NoData zh={zh} /> : <>
        <Scanner onCode={go} zh={zh} />
        <div className="muted small" style={{ textAlign: 'center' }}>{zh ? '對準瓶號、酒箱、架子或分儲空間的 QR Code' : 'Point at a bottle, case, rack or locker QR code'}</div>
        {msg && <div className={'flash ' + msg.kind}>{msg.text}</div>}
        <ManualInput zh={zh} onCode={go} />
        {recent.length > 0 && <>
          <b>{zh ? '最近掃描' : 'Recent'}</b>
          <div className="mlist">{recent.map(([c, r]) => (
            <Link key={c} to={r.type === 'bottle' ? '/m/b/' + c : r.type === 'case' ? '/m/c/' + encodeURIComponent(r.case_no) : r.type === 'wine' ? '/m/w/' + c : '/m/l/' + (r.rack?.locker_id || r.id)}>
              <span><b>{r.type === 'case' ? (zh ? '箱 ' : 'Case ') + r.case_no : r.type === 'bottle' ? r.bottle_no : r.label || c}</b>
                <div className="muted small">{r.wine?.name || r.w?.name || ''}{r.type === 'case' ? ` · ${r.bottles.length} ${zh ? '瓶' : 'btl'}` : ''}</div></span>
              <span className="muted small">{r.type !== 'wine' ? (r.label || '').split(' › ').slice(1, 2).join('') : ''} ›</span>
            </Link>))}</div>
        </>}
      </>}
    </div>
  );
}

// ===== 酒瓶 =====
export function MBottle() {
  const zh = useZh();
  const { no } = useParams();
  const nav = useNavigate();
  const [s, st] = useSnap();
  const [live, setLive] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef();
  useEffect(() => { if (st.online) api('/api/bottles/' + no).then(setLive).catch(() => {}); }, [no, st.online]);
  if (!s) return <div className="mpage"><MHead title={no} /><NoData zh={zh} /></div>;
  const b = s.byBottle.get(no);
  if (!b) return <div className="mpage"><MHead title={no} /><div className="card">{zh ? '手機資料裡找不到這個瓶號（可能已出貨）。' : 'Bottle not in phone data.'}</div></div>;
  const w = s.byWineId.get(b.wine_id);
  const winebottles = s.bottles.filter((x) => x.wine_id === b.wine_id && x.status === 'in_stock').length;
  const caseCount = b.case_no ? s.bottles.filter((x) => x.case_no === b.case_no && x.status === 'in_stock').length : 0;
  const mark = async () => { await queueOp('stockout', { bottle_nos: [no], reason, note }); setDlg(false); toast(zh ? '已出庫' + (st.online ? '' : '，回公司後同步') : 'Removed from stock'); };
  const photo = async (f) => {
    if (!f) return;
    const fd = new FormData(); fd.append('photos', f);
    try { await api(`/api/wines/${w.wine_no}/photos`, { method: 'POST', body: fd }); toast(zh ? '已上傳照片' : 'Photo uploaded'); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="mpage">
      <MHead title={no} right={<span className={'tag ' + (b.status === 'in_stock' ? 'ok' : 'warn')}>{STATUS_ZH[b.status]}</span>} />
      <SyncPill zh={zh} />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b style={{ fontSize: 17 }}>{w?.name}</b>
        <span className="muted">{zh ? w?.type_zh : w?.type_en} · {w?.vintage} · {w?.volume_ml} ml</span>
        <Link to={'/m/w/' + w?.wine_no}>{zh ? `查看酒款（${winebottles} 瓶）›` : `Wine (${winebottles}) ›`}</Link>
      </div>
      <div className="card"><dl className="dl">
        <dt>{zh ? '位置' : 'Location'}</dt><dd>{rackLabel(s, b.rack_id)}</dd>
        <dt>{zh ? '酒箱' : 'Case'}</dt><dd>{b.case_no ? <Link to={'/m/c/' + encodeURIComponent(b.case_no)}>{b.case_no}</Link> : (zh ? '散瓶' : 'Loose')}{b.case_no ? `（${caseCount} ${zh ? '瓶' : 'btl'}）` : ''}</dd>
        <dt>{zh ? '市場價格' : 'Market price'}</dt><dd>{ntd(w?.price)} <span className="muted small">{w?.price_date}</span></dd>
        {live && <><dt>{zh ? '採購價格' : 'Cost'}</dt><dd>{ntd(live.cost)} <span className="muted small">{live.merchant}</span></dd></>}
      </dl>{!live && <div className="muted small" style={{ marginTop: 6 }}>{zh ? '採購價格只在連線時顯示。' : 'Cost is shown only when online.'}</div>}</div>
      {(b.status === 'in_stock' || b.status === 'reserved') && <button className="btn primary bigbtn" onClick={() => nav('/m/move?b=' + no)}>{zh ? '移動這瓶' : 'Move this bottle'}</button>}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        {b.status === 'in_stock' && <button className="btn bigbtn" onClick={() => setDlg(true)}>{zh ? '出庫' : 'Remove'}</button>}
        <button className="btn bigbtn" disabled={!st.online} onClick={() => fileRef.current.click()}>{zh ? '拍照上傳' : 'Take photo'}</button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => photo(e.target.files[0])} />
      </div>
      {!st.online && <div className="muted small">{zh ? '拍照上傳需要連線。' : 'Photos need a connection.'}</div>}
      {dlg && (
        <Modal title={(zh ? '出庫 ' : 'Remove ') + no} onClose={() => setDlg(false)}
          footer={<><button className="btn" onClick={() => setDlg(false)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!reason || (reason === 'other' && !note.trim())} onClick={mark}>{zh ? '確認出庫' : 'Remove'}</button></>}>
          <ReasonPicker reason={reason} setReason={setReason} note={note} setNote={setNote} zh={zh} />
        </Modal>
      )}
    </div>
  );
}

// ===== 酒箱 =====
export function MCase() {
  const zh = useZh();
  const { no } = useParams();
  const nav = useNavigate();
  const [s, st] = useSnap();
  const [out, setOut] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  if (!s) return <div className="mpage"><MHead title={no} /><NoData zh={zh} /></div>;
  const c = s.byCase.get(no);
  if (!c) return <div className="mpage"><MHead title={no} /><div className="card">{zh ? '找不到這個酒箱' : 'Case not found'}</div></div>;
  const bottles = s.bottles.filter((b) => b.case_no === no);
  const wines = [...new Set(bottles.map((b) => b.wine_id))].map((id) => s.byWineId.get(id));
  return (
    <div className="mpage">
      <MHead title={(zh ? '箱 ' : 'Case ') + no} />
      <SyncPill zh={zh} />
      <div className="card"><dl className="dl">
        <dt>{zh ? '位置' : 'Location'}</dt><dd>{rackLabel(s, c.rack_id)}{c.uncertain ? <span className="tag warn" style={{ marginLeft: 6 }}>{zh ? '待確認' : 'to confirm'}</span> : null}</dd>
        <dt>{zh ? '瓶數' : 'Bottles'}</dt><dd>{bottles.filter((b) => b.status === 'in_stock').length}{c.capacity ? ' / ' + c.capacity : ''}</dd>
        <dt>{zh ? '酒款' : 'Wine'}</dt><dd>{wines.map((w) => <div key={w.id}><Link to={'/m/w/' + w.wine_no}>{w.name}</Link> {w.vintage}</div>)}</dd>
      </dl></div>
      <button className="btn primary bigbtn" onClick={() => nav('/m/move?case=' + encodeURIComponent(no))}>{zh ? '移動整箱' : 'Move whole case'}</button>
      {bottles.some((b) => b.status === 'in_stock') && <button className="btn bigbtn" onClick={() => setOut(true)}>{zh ? '整箱出庫' : 'Remove whole case'}</button>}
      {out && (
        <Modal title={(zh ? '整箱出庫 ' : 'Remove case ') + no} onClose={() => setOut(false)}
          footer={<><button className="btn" onClick={() => setOut(false)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!reason || (reason === 'other' && !note.trim())} onClick={async () => {
            await queueOp('stockout', { bottle_nos: bottles.filter((b) => b.status === 'in_stock').map((b) => b.bottle_no), reason, note }); setOut(false); toast(zh ? '已出庫' + (st.online ? '' : '，回公司後同步') : 'Removed');
          }}>{zh ? `確認出庫 ${bottles.filter((b) => b.status === 'in_stock').length} 瓶` : 'Remove'}</button></>}>
          <ReasonPicker reason={reason} setReason={setReason} note={note} setNote={setNote} zh={zh} />
        </Modal>
      )}
      <div className="mlist">{bottles.map((b) => <Link key={b.bottle_no} to={'/m/b/' + b.bottle_no}><span>{b.bottle_no}</span><span className="muted small">{STATUS_ZH[b.status]} ›</span></Link>)}</div>
    </div>
  );
}

// ===== 分儲空間 =====
export function MLocker() {
  const zh = useZh();
  const { id } = useParams();
  const [s] = useSnap();
  if (!s) return <div className="mpage"><MHead title="…" /><NoData zh={zh} /></div>;
  const l = s.byLocker.get(Number(id));
  if (!l) return <div className="mpage"><MHead title="?" /><div className="card">—</div></div>;
  const racks = s.racks.filter((r) => r.locker_id === l.id);
  return (
    <div className="mpage">
      <MHead title={`${s.byCellar.get(l.cellar_id)?.name} › ${l.code}`} />
      <div className="row"><Link className="btn" to={'/m/count?locker=' + l.id}>{zh ? '盤點這裡' : 'Count here'}</Link></div>
      {racks.map((r) => {
        const cases = s.cases.filter((c) => c.rack_id === r.id);
        const loose = s.bottles.filter((b) => b.rack_id === r.id && !b.case_no && b.status === 'in_stock');
        return (
          <div key={r.id}><b>{zh ? '架子 ' : 'Rack '}{r.code}</b>
            <div className="mlist" style={{ marginTop: 6 }}>
              {cases.map((c) => { const bs = s.bottles.filter((b) => b.case_no === c.case_no && b.status === 'in_stock'); return (
                <Link key={c.case_no} to={'/m/c/' + encodeURIComponent(c.case_no)}><span><b>{c.case_no}</b><div className="muted small">{s.byWineId.get(bs[0]?.wine_id)?.name || (zh ? '（空箱）' : '(empty)')}</div></span><span className="muted small">{bs.length} {zh ? '瓶' : 'btl'} ›</span></Link>); })}
              {loose.map((b) => <Link key={b.bottle_no} to={'/m/b/' + b.bottle_no}><span>{b.bottle_no}<div className="muted small">{s.byWineId.get(b.wine_id)?.name}</div></span><span className="tag">{zh ? '散瓶' : 'loose'}</span></Link>)}
              {!cases.length && !loose.length && <div className="muted small">{zh ? '空' : 'Empty'}</div>}
            </div>
          </div>);
      })}
    </div>
  );
}

// ===== 酒款 =====
export function MWine() {
  const zh = useZh();
  const { no } = useParams();
  const [s] = useSnap();
  if (!s) return <div className="mpage"><MHead title={no} /><NoData zh={zh} /></div>;
  const w = s.byWineNo.get(no);
  if (!w) return <div className="mpage"><MHead title={no} /><div className="card">—</div></div>;
  const bottles = s.bottles.filter((b) => b.wine_id === w.id && b.status === 'in_stock');
  const groups = new Map();
  for (const b of bottles) { const k = b.case_no || 'R' + b.rack_id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  return (
    <div className="mpage">
      <MHead title={w.name} />
      <div className="card"><dl className="dl">
        <dt>{zh ? '酒莊' : 'Winery'}</dt><dd>{w.winery}</dd><dt>{zh ? '年份' : 'Vintage'}</dt><dd>{w.vintage}</dd>
        <dt>{zh ? '種類' : 'Type'}</dt><dd>{zh ? w.type_zh : w.type_en}</dd><dt>{zh ? '在庫' : 'In stock'}</dt><dd>{bottles.length} {zh ? '瓶' : 'btl'}</dd>
        <dt>{zh ? '市場價格' : 'Market price'}</dt><dd>{ntd(w.price)} <span className="muted small">{w.price_date}</span></dd>
      </dl></div>
      <div className="mlist">{[...groups.entries()].map(([k, bs]) => (
        <Link key={k} to={bs[0].case_no ? '/m/c/' + encodeURIComponent(bs[0].case_no) : '/m/b/' + bs[0].bottle_no}>
          <span><b>{bs[0].case_no ? (zh ? '箱 ' : 'Case ') + bs[0].case_no : (zh ? '散瓶' : 'Loose')}</b><div className="muted small">{rackLabel(s, bs[0].rack_id)}</div></span><span className="muted small">{bs.length} {zh ? '瓶' : 'btl'} ›</span></Link>))}</div>
    </div>
  );
}

// ===== 移動 =====
export function MMove() {
  const zh = useZh();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [s] = useSnap();
  const [items, setItems] = useState([]); // bottle_nos
  const [wholeCase, setWholeCase] = useState(sp.get('case') || '');
  const [dest, setDest] = useState(null); // { kind: 'rack', rack_id } | { kind: 'case', case_no }
  const [newCase, setNewCase] = useState(false);
  const [note, setNote] = useState('');
  const [step, setStep] = useState(sp.get('b') || sp.get('case') ? 2 : 1);
  const [msg, setMsg] = useState(null);
  const [pickLocker, setPickLocker] = useState(null);
  useEffect(() => { if (sp.get('b')) setItems([sp.get('b')]); }, [sp]);
  if (!s) return <div className="mpage"><MHead title={zh ? '移動' : 'Move'} /><NoData zh={zh} /></div>;
  const onSource = (code) => {
    const r = resolveLocal(s, code);
    if (!r) return setMsg({ kind: 'err', text: (zh ? '找不到：' : 'Not found: ') + code });
    if (r.type === 'bottle') {
      if (r.b.status !== 'in_stock' && r.b.status !== 'reserved') return setMsg({ kind: 'err', text: r.bottle_no + (zh ? ' 不在庫' : ' not in stock') });
      if (items.includes(r.bottle_no)) return setMsg({ kind: 'warn', text: r.bottle_no + (zh ? ' 已在清單中' : ' already added') });
      setWholeCase(''); setItems([...items, r.bottle_no]); setMsg({ kind: 'ok', text: `${r.bottle_no} · ${r.wine?.name}` });
    } else if (r.type === 'case') {
      if (!items.length) { setWholeCase(r.case_no); setMsg({ kind: 'ok', text: (zh ? `整箱 ${r.case_no}（${r.bottles.length} 瓶）` : `Whole case ${r.case_no}`) }); }
      else { const add = r.bottles.map((b) => b.bottle_no).filter((x) => !items.includes(x)); setItems([...items, ...add]); setMsg({ kind: 'ok', text: zh ? `加入箱內 ${add.length} 瓶` : `Added ${add.length}` }); }
    } else setMsg({ kind: 'err', text: zh ? '請掃描酒瓶或酒箱' : 'Scan a bottle or case' });
  };
  const onDest = (code) => {
    const r = resolveLocal(s, code);
    if (!r) return setMsg({ kind: 'err', text: (zh ? '找不到：' : 'Not found: ') + code });
    if (r.type === 'rack') { setDest({ kind: 'rack', rack_id: r.id }); setMsg(null); }
    else if (r.type === 'locker') { setPickLocker(r.id); setMsg(null); }
    else if (r.type === 'case' && !wholeCase) { setDest({ kind: 'case', case_no: r.case_no }); setMsg(null); }
    else setMsg({ kind: 'err', text: zh ? '請掃描目的地架子' + (wholeCase ? '' : '或酒箱') : 'Scan a rack' + (wholeCase ? '' : ' or case') });
  };
  const from = wholeCase ? rackLabel(s, s.byCase.get(wholeCase)?.rack_id) : [...new Set(items.map((no) => s.byBottle.get(no)).map((b) => b?.case_no || rackLabel(s, b?.rack_id)))].join('、');
  const destLabel = !dest ? '' : dest.kind === 'case' ? `${zh ? '酒箱' : 'Case'} ${dest.case_no} @ ${rackLabel(s, s.byCase.get(dest.case_no)?.rack_id)}` : (newCase && !wholeCase ? (zh ? '新酒箱 @ ' : 'New case @ ') : '') + rackLabel(s, dest.rack_id);
  const destCase = dest?.kind === 'case' ? s.byCase.get(dest.case_no) : null;
  const destCount = destCase ? s.bottles.filter((b) => b.case_no === destCase.case_no && b.status === 'in_stock').length : 0;
  const n = wholeCase ? s.bottles.filter((b) => b.case_no === wholeCase && b.status === 'in_stock').length : items.length;
  const confirm = async () => {
    if (wholeCase) await queueOp('move_case', { case_no: wholeCase, rack_id: dest.rack_id, note });
    else await queueOp('move_bottles', { bottle_nos: items, dest: dest.kind === 'case' ? { mode: 'case', case_no: dest.case_no } : { mode: newCase ? 'newcase' : 'loose', rack_id: dest.rack_id, capacity: 6 }, note });
    toast(zh ? `已移動 ${n} 瓶，${navigator.onLine ? '同步中' : '回公司後同步'}` : `Moved ${n} bottles`);
    nav(wholeCase ? '/m/c/' + encodeURIComponent(wholeCase) : '/m');
  };
  return (
    <div className="mpage">
      <MHead title={zh ? '移動酒瓶' : 'Move'} right={<SyncPill zh={zh} />} />
      {step === 1 ? <>
        <b>{zh ? '1. 要移動的酒瓶' : '1. What to move'}</b>
        <Scanner onCode={onSource} zh={zh} />
        {msg && <div className={'flash ' + msg.kind}>{msg.text}</div>}
        <ManualInput zh={zh} onCode={onSource} placeholder={zh ? '瓶號或箱號' : 'Bottle or case no.'} />
      </> : <>
        <div className="row between"><b>{zh ? '1. 要移動的酒瓶' : '1. What to move'}</b><button className="btn mini" onClick={() => setStep(1)}>{zh ? '＋ 再掃一瓶' : '+ Scan more'}</button></div>
      </>}
      <div className="mlist">
        {wholeCase ? <div><span><b>{zh ? '整箱 ' : 'Case '}{wholeCase}</b><div className="muted small">{n} {zh ? '瓶' : 'btl'} · {zh ? '目前' : 'now'} {from}</div></span><button className="btn ghost mini" onClick={() => setWholeCase('')}>×</button></div>
          : items.map((no) => { const b = s.byBottle.get(no); return (
            <div key={no}><span><b>{no}</b><div className="muted small">{s.byWineId.get(b?.wine_id)?.name} · {zh ? '目前' : 'now'} {b?.case_no ? b.case_no : rackLabel(s, b?.rack_id).split(' › ')[1]}</div></span>
              <button className="btn ghost mini" onClick={() => setItems(items.filter((x) => x !== no))} aria-label={zh ? '移除' : 'Remove'}>×</button></div>); })}
        {!wholeCase && !items.length && <div className="muted small">{zh ? '掃描瓶號；掃箱號會移動整箱。' : 'Scan bottles; a case moves whole.'}</div>}
      </div>
      {step === 1 && n > 0 && <button className="btn primary bigbtn" onClick={() => { setStep(2); setMsg(null); }}>{zh ? '下一步：選目的地' : 'Next: destination'}</button>}
      {step === 2 && n > 0 && <>
        <b>{zh ? '2. 移到哪裡' : '2. Where to'}</b>
        {!dest ? <>
          <Scanner onCode={onDest} zh={zh} />
          <div className="muted small" style={{ textAlign: 'center' }}>{zh ? '掃描目的地架子' + (wholeCase ? '' : '或酒箱') : 'Scan destination'}</div>
          {msg && <div className={'flash ' + msg.kind}>{msg.text}</div>}
          <ManualInput zh={zh} onCode={onDest} placeholder="RACK:12 / 12-06-23-07" />
          <select className="input" value="" onChange={(e) => e.target.value && setPickLocker(Number(e.target.value))}>
            <option value="">{zh ? '或選擇分儲空間…' : 'Or pick a locker…'}</option>
            {s.lockers.map((l) => <option key={l.id} value={l.id}>{s.byCellar.get(l.cellar_id)?.name} › {l.code}</option>)}
          </select>
        </> : <>
          <div className="flash ok"><b>{zh ? '已選目的地' : 'Destination'}</b><div>{destLabel}</div>{destCase && <div className="small">（{destCount} → {destCount + n}{destCase.capacity ? ' / ' + destCase.capacity : ''} {zh ? '瓶' : 'btl'}）</div>}</div>
          {destCase?.capacity && destCount + n > destCase.capacity && <div className="flash warn">{zh ? '超過酒箱容量' : 'Over capacity'}</div>}
          {dest.kind === 'rack' && !wholeCase && <label className="check"><input type="checkbox" checked={newCase} onChange={(e) => setNewCase(e.target.checked)} />{zh ? '裝入新酒箱（自動編號）' : 'Put in a new case'}</label>}
          <button className="btn mini" style={{ alignSelf: 'flex-start' }} onClick={() => setDest(null)}>{zh ? '重新選擇' : 'Change'}</button>
          <label className="f">{zh ? '備註（選填）' : 'Note'}<input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="muted small">{n} {zh ? '瓶' : 'btl'} {from} → {destLabel} · {zh ? '記入異動紀錄' : 'logged'}</div>
          <button className="btn primary bigbtn" onClick={confirm}>{zh ? `確認移動 ${n} 瓶` : `Move ${n} bottles`}</button>
        </>}
      </>}
      {pickLocker && (
        <Modal title={zh ? '選擇架子' : 'Pick a rack'} onClose={() => setPickLocker(null)}>
          {s.racks.filter((r) => r.locker_id === pickLocker).map((r) => <button key={r.id} className="btn" onClick={() => { setDest({ kind: 'rack', rack_id: r.id }); setPickLocker(null); }}>{rackLabel(s, r.id)}</button>)}
        </Modal>
      )}
    </div>
  );
}

// ===== 掃描建立清單 =====
export function MScanList() {
  const zh = useZh();
  const nav = useNavigate();
  const [s, st] = useSnap();
  const [codes, setCodes] = useState([]);
  const [msg, setMsg] = useState(null);
  const [name, setName] = useState('');
  const [lists, setLists] = useState(null);
  if (!s) return <div className="mpage"><MHead title={zh ? '掃描建立清單' : 'Scan to list'} /><NoData zh={zh} /></div>;
  const items = codes.map((c) => [c, resolveLocal(s, c)]);
  const bottles = items.reduce((n, [, r]) => n + (r.type === 'case' ? r.bottles.length : r.type === 'bottle' ? 1 : r.type === 'locker' ? s.bottles.filter((b) => s.byRack.get(b.rack_id)?.locker_id === r.id && b.status === 'in_stock').length : 0), 0);
  const add = (code) => {
    const r = resolveLocal(s, code);
    if (!r || r.type === 'rack') return setMsg({ kind: 'err', text: (zh ? '無法加入：' : 'Cannot add: ') + code });
    const key = r.type === 'case' ? r.case_no : r.type === 'bottle' ? r.bottle_no : r.type === 'wine' ? r.wine_no : 'LOCKER:' + r.id;
    if (codes.includes(key)) return setMsg({ kind: 'warn', text: key + (zh ? ' 已在清單中，已略過' : ' already in list') });
    setCodes([...codes, key]); setMsg({ kind: 'ok', text: (zh ? `已加入 ${codes.length + 1} 項` : `${codes.length + 1} added`) });
  };
  const save = async () => { await queueOp('list_create', { name, codes }); toast(zh ? '清單已儲存' + (st.online ? '' : '，回公司後同步') : 'List saved'); nav(st.online ? '/lists' : '/m'); };
  const addExisting = async (id) => {
    try { const r = await api(`/api/lists/${id}/items`, { method: 'POST', body: { codes } }); toast(zh ? `已加入 ${r.added} 款` : `Added ${r.added}`); nav('/lists/' + id); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="mpage">
      <MHead title={zh ? '掃描建立清單' : 'Scan to list'} right={<span className="tag">{zh ? '連續掃描' : 'Continuous'}</span>} />
      <SyncPill zh={zh} />
      <Scanner onCode={add} zh={zh} />
      <div className="muted small" style={{ textAlign: 'center' }}>{zh ? '掃瓶號、箱號或分儲空間 QR Code' : 'Scan bottles, cases or lockers'}</div>
      {msg && <div className={'flash ' + msg.kind}>{msg.text}</div>}
      <ManualInput zh={zh} onCode={add} />
      <div className="muted">{zh ? `已加入 ${codes.length} 項 · 共 ${bottles} 瓶` : `${codes.length} items · ${bottles} bottles`}</div>
      <div className="mlist">{items.map(([c, r]) => (
        <div key={c}><span><span className="tag" style={{ marginRight: 6 }}>{{ case: zh ? '箱' : 'Case', bottle: zh ? '瓶' : 'Btl', locker: zh ? '分儲' : 'Locker', wine: zh ? '酒款' : 'Wine' }[r.type]}</span><b>{r.type === 'locker' ? r.label : c}</b>
          <div className="muted small">{r.wine?.name || r.w?.name || ''}{r.type === 'case' ? ` · ${r.bottles.length} ${zh ? '瓶' : 'btl'}` : ''}</div></span>
          <button className="btn ghost mini" onClick={() => setCodes(codes.filter((x) => x !== c))}>×</button></div>))}</div>
      {codes.length > 0 && <>
        <label className="f">{zh ? '清單名稱' : 'List name'}<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={zh ? '例：盤點 ' + new Date().toISOString().slice(0, 10) : 'List name'} /></label>
        <button className="btn primary bigbtn" disabled={!name.trim()} onClick={save}>{zh ? '儲存清單' : 'Save list'}</button>
        {st.online && <button className="btn bigbtn" onClick={async () => setLists(await api('/api/lists'))}>{zh ? '加入既有清單' : 'Add to existing list'}</button>}
      </>}
      {lists && <Modal title={zh ? '加入既有清單' : 'Add to list'} onClose={() => setLists(null)}>{lists.map((l) => <button key={l.id} className="btn" onClick={() => addExisting(l.id)}>{l.name}</button>)}</Modal>}
    </div>
  );
}

// ===== 盤點 =====
export function MCount() {
  const zh = useZh();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [s] = useSnap();
  const [locker, setLocker] = useState(sp.get('locker') ? Number(sp.get('locker')) : null);
  const [codes, setCodes] = useState([]);
  const [msg, setMsg] = useState(null);
  const started = useRef(new Date().toISOString());
  const expected = useMemo(() => {
    if (!s || !locker) return [];
    const racks = new Set(s.racks.filter((r) => r.locker_id === locker).map((r) => r.id));
    return s.cases.filter((c) => racks.has(c.rack_id) && s.bottles.some((b) => b.case_no === c.case_no && b.status === 'in_stock'));
  }, [s, locker]);
  if (!s) return <div className="mpage"><MHead title={zh ? '盤點' : 'Count'} /><NoData zh={zh} /></div>;
  const pickByScan = (code) => { const r = resolveLocal(s, code); if (r?.type === 'locker') setLocker(r.id); else if (r?.type === 'rack') setLocker(r.rack.locker_id); else setMsg({ kind: 'err', text: zh ? '請先掃描分儲空間或架子' : 'Scan a locker first' }); };
  const scan = (code) => {
    const r = resolveLocal(s, code);
    if (!r) { setCodes([...codes, code]); return setMsg({ kind: 'err', text: (zh ? '不認得的編號：' : 'Unknown: ') + code }); }
    if (r.type === 'locker' || r.type === 'rack') return;
    const key = r.type === 'case' ? r.case_no : r.bottle_no || code;
    if (codes.includes(key)) return setMsg({ kind: 'warn', text: key + (zh ? ' 已掃過' : ' already scanned') });
    setCodes([...codes, key]);
    const here = r.type === 'case' ? expected.some((c) => c.case_no === r.case_no) : s.byRack.get(r.b?.rack_id)?.locker_id === locker;
    setMsg(here ? { kind: 'ok', text: `${key} ✓` } : { kind: 'warn', text: `${key} ${zh ? '記錄在' : 'recorded at'} ${r.label}` });
  };
  const found = new Set(codes.map((c) => { const r = resolveLocal(s, c); return r?.type === 'case' ? r.case_no : r?.type === 'bottle' ? r.b.case_no : null; }).filter(Boolean));
  const finish = async () => { await queueOp('count', { locker_id: locker, codes, started_at: started.current }); toast(zh ? '盤點已儲存，回公司產生差異報告' : 'Count saved'); nav('/m/sync'); };
  const l = locker && s.byLocker.get(locker);
  return (
    <div className="mpage">
      <MHead title={zh ? '盤點' : 'Count'} right={<SyncPill zh={zh} />} />
      {!locker ? <>
        <div className="muted">{zh ? '先掃描分儲空間（或架子）的 QR Code，或從清單選擇。' : 'Scan the locker first.'}</div>
        <Scanner onCode={pickByScan} zh={zh} />
        {msg && <div className={'flash ' + msg.kind}>{msg.text}</div>}
        <select className="input" value="" onChange={(e) => setLocker(Number(e.target.value))}><option value="">{zh ? '選擇分儲空間…' : 'Pick a locker…'}</option>
          {s.lockers.map((x) => <option key={x.id} value={x.id}>{s.byCellar.get(x.cellar_id)?.name} › {x.code}</option>)}</select>
      </> : <>
        <div className="card row between"><b>{s.byCellar.get(l.cellar_id)?.name} › {l.code}</b><span className="muted">{zh ? `找到 ${expected.filter((c) => found.has(c.case_no)).length} / ${expected.length} 箱` : `${expected.filter((c) => found.has(c.case_no)).length} / ${expected.length} cases`}</span></div>
        <Scanner onCode={scan} zh={zh} />
        {msg && <div className={'flash ' + msg.kind}>{msg.text}</div>}
        <ManualInput zh={zh} onCode={scan} />
        <div className="mlist">{expected.map((c) => <div key={c.case_no}><span>{c.case_no}<div className="muted small">{s.byWineId.get(s.bottles.find((b) => b.case_no === c.case_no)?.wine_id)?.name}</div></span>{found.has(c.case_no) ? <span className="tag ok">✓</span> : <span className="tag">{zh ? '未掃' : 'Not yet'}</span>}</div>)}</div>
        <button className="btn primary bigbtn" disabled={!codes.length} onClick={finish}>{zh ? `完成盤點（掃了 ${codes.length} 項）` : `Finish (${codes.length})`}</button>
      </>}
    </div>
  );
}

// ===== 搜尋（離線也可用）=====
export function MSearch() {
  const zh = useZh();
  const [s] = useSnap();
  const [q, setQ] = useState('');
  const [types, setTypes] = useState([]);
  if (!s) return <div className="mpage"><MHead title={zh ? '庫存搜尋' : 'Search'} back={null} /><NoData zh={zh} /></div>;
  const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nq = norm(q).trim();
  const counts = new Map(); const cases = new Map(); const lockers = new Map();
  for (const b of s.bottles) if (b.status === 'in_stock') {
    counts.set(b.wine_id, (counts.get(b.wine_id) || 0) + 1);
    if (b.case_no) { if (!cases.has(b.wine_id)) cases.set(b.wine_id, new Set()); cases.get(b.wine_id).add(b.case_no); }
    const lk = s.byLocker.get(s.byRack.get(b.rack_id)?.locker_id)?.code; if (!lockers.has(b.wine_id)) lockers.set(b.wine_id, new Set()); lockers.get(b.wine_id).add(lk);
  }
  const rows = s.wines.filter((w) => counts.get(w.id) && (!types.length || types.includes(w.type_code)) && (!nq || norm(`${w.wine_no} ${w.winery} ${w.name} ${w.region} ${w.vintage}`).includes(nq) || [...(lockers.get(w.id) || [])].some((x) => norm(x) === nq)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalB = rows.reduce((n, w) => n + counts.get(w.id), 0), totalC = rows.reduce((n, w) => n + (cases.get(w.id)?.size || 0), 0);
  const typeList = s.types.filter((t) => s.wines.some((w) => w.type_code === t.code && counts.get(w.id)));
  return (
    <div className="mpage">
      <MHead title={zh ? '庫存搜尋' : 'Search'} back={null} right={<SyncPill zh={zh} />} />
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={zh ? '酒莊、品名、產區、年份、分儲空間' : 'Winery, name, region…'} />
      <div className="chips">{typeList.map((t) => <button key={t.code} className="chip" style={{ border: 0, background: types.includes(t.code) ? 'var(--wine)' : 'var(--wine-soft)', color: types.includes(t.code) ? '#fff' : 'var(--wine)', padding: '6px 12px' }}
        onClick={() => setTypes(types.includes(t.code) ? types.filter((x) => x !== t.code) : [...types, t.code])}>{zh ? t.zh : t.en}</button>)}</div>
      <div className="muted small">{zh ? `${rows.length} 款 · ${totalC} 箱 · ${totalB} 瓶` : `${rows.length} wines · ${totalC} cases · ${totalB} bottles`}</div>
      <div className="mlist">{rows.slice(0, 200).map((w) => (
        <Link key={w.id} to={'/m/w/' + w.wine_no}><span><b>{w.name}</b><div className="muted small">{w.vintage} · {[...(lockers.get(w.id) || [])].join(',')}</div></span>
          <span style={{ textAlign: 'right' }}>{counts.get(w.id)} {zh ? '瓶' : 'btl'}<div className="muted small">{ntd(w.price)}</div></span></Link>))}</div>
    </div>
  );
}

// ===== 同步狀態 =====
export function MSync() {
  const zh = useZh();
  const nav = useNavigate();
  const st = useOffline();
  const [s] = useSnap();
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { const r = await fn(); if (r?.error) toast(r.error, 'err'); else if (r && r.online === false) toast(zh ? '連不到公司伺服器，請連公司 Wi-Fi' : 'Cannot reach the office server', 'err'); } finally { setBusy(false); } };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
  return (
    <div className="mpage">
      <MHead title={zh ? '同步' : 'Sync'} />
      <div className={'flash ' + (st.online ? 'ok' : 'warn')}>
        <b>{st.online ? (zh ? '已連上公司伺服器' : 'Connected to the office server') : (zh ? '離線中' : 'Offline')}</b>
        <div className="small">{zh ? '最後同步：' : 'Last sync: '}{when(st.lastSync)}</div>
        {!st.online && <div className="small">{zh ? '回到公司連上 Wi-Fi 後會自動上傳。' : 'Uploads automatically on the office Wi-Fi.'}</div>}
      </div>
      {st.error && <div className="flash err">{st.error}</div>}
      {st.conflicts > 0 && <Link className="btn primary bigbtn" to="/m/conflicts">{zh ? `查看同步衝突（${st.conflicts}）` : `Review conflicts (${st.conflicts})`}</Link>}
      <div className="row between"><b>{zh ? `待同步 ${st.pending} 筆` : `${st.pending} pending`}</b><span className="muted small">{zh ? '依操作時間' : 'By time'}</span></div>
      <div className="mlist">{st.ops.map((op) => { const d = describeOp(s, op, zh); return <div key={op.id}><span className="muted small" style={{ minWidth: 44 }}>{when(op.ts).split(' ').pop()}</span><span style={{ flex: 1 }}><b>{d.title}</b><div className="muted small">{d.sub}</div></span></div>; })}
        {!st.ops.length && <div className="muted small">{zh ? '沒有待同步的操作' : 'Nothing pending'}</div>}</div>
      <button className="btn primary bigbtn" disabled={busy || st.syncing} onClick={() => run(() => sync())}>{st.syncing ? (zh ? '同步中…' : 'Syncing…') : (zh ? '立即同步' : 'Sync now')}</button>
      <div className="card">
        <b>{zh ? '手機上的資料' : 'Data on this phone'}</b>
        {st.snap ? <div className="small" style={{ marginTop: 6 }}>{zh ? `${st.snap.wines} 款 · ${st.snap.bottles} 瓶 · ${st.snap.cases} 箱 · 下載於 ${when(st.snap.at)}` : `${st.snap.wines} wines · ${st.snap.bottles} bottles · ${st.snap.cases} cases`}</div> : <div className="small muted">—</div>}
        <div className="muted small">{zh ? '不含採購價格、酒商、客戶與設定；登出時清除。' : 'No costs, merchants, customers or settings; cleared on logout.'}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn mini" disabled={busy || !st.online} onClick={() => run(() => refreshSnapshot())}>{zh ? '重新下載資料' : 'Re-download'}</button>
          <button className="btn mini" disabled={busy} onClick={async () => { if (st.pending && !confirm(zh ? `還有 ${st.pending} 筆沒同步，清除後會遺失。確定？` : 'Pending changes will be lost. Continue?')) return; await clearLocal(); nav('/m/sync'); }}>{zh ? '清除手機資料' : 'Clear phone data'}</button>
        </div>
      </div>
    </div>
  );
}

// ===== 同步衝突 =====
export function MConflicts() {
  const zh = useZh();
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [i, setI] = useState(0);
  const [s] = useSnap();
  const load = () => api('/api/offline/conflicts').then(setList).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);
  if (!list) return <div className="mpage"><MHead title={zh ? '同步衝突' : 'Conflicts'} /><div className="muted">…</div></div>;
  if (!list.length) return <div className="mpage"><MHead title={zh ? '同步衝突' : 'Conflicts'} /><div className="flash ok">{zh ? '沒有需要確認的衝突' : 'No conflicts'}</div><Link className="btn bigbtn" to="/m">{zh ? '回掃描' : 'Back to scan'}</Link></div>;
  const c = list[Math.min(i, list.length - 1)];
  const d = describeOp(s, { type: c.type, payload: c.payload }, zh);
  const choose = async (choice) => {
    try { await api('/api/offline/resolve', { method: 'POST', body: { id: c.id, choice } }); toast(zh ? '已處理' : 'Resolved'); await sync(); const left = list.filter((x) => x.id !== c.id); setList(left); setI(0); if (!left.length) nav('/m/sync'); } catch (e) { toast(e.message, 'err'); }
  };
  const when = (iso) => (iso ? new Date(String(iso).replace(' ', 'T')).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  return (
    <div className="mpage">
      <MHead title={zh ? '同步衝突' : 'Conflicts'} right={<span className="muted">{Math.min(i, list.length - 1) + 1} / {list.length}</span>} />
      <div className="muted">{zh ? '你離線時操作的項目，在你回來之前已被別人改過。請選擇要保留哪一個。' : 'Someone changed this while you were offline. Choose which to keep.'}</div>
      {c.conflict.diffs.map((x) => <div className="card" key={x.bottle_no || x.case_no}><b>{x.bottle_no || x.case_no}</b><div className="muted small">{zh ? '離線前位置：' : 'Before: '}{x.was}</div></div>)}
      <div className="card" style={{ borderColor: 'var(--wine)' }}><b>{zh ? '你的動作' : 'Your change'}</b><div className="muted small">{c.user_login} · {when(c.op_ts)}{zh ? '（離線）' : ' (offline)'}</div><div>{d.title}</div><div className="small">{d.sub}</div></div>
      <div className="card"><b>{zh ? '伺服器' : 'Server'}</b>{c.conflict.by && <div className="muted small">{c.conflict.by.user_login} · {when(c.conflict.by.ts)} · {c.conflict.by.action}</div>}
        {c.conflict.diffs.map((x) => <div key={'n' + (x.bottle_no || x.case_no)}>{zh ? '已在 ' : 'Now at '}{x.now}</div>)}</div>
      <div className="muted small">{zh ? '兩個選擇都會記入異動紀錄，標示「離線同步」。不確定時可先保留伺服器的，到現場確認後再移動。' : 'Both choices are logged. If unsure, keep the server and check on site.'}</div>
      <button className="btn primary bigbtn" onClick={() => choose('mine')}>{zh ? '保留我的動作' : 'Keep mine'}</button>
      <button className="btn bigbtn" onClick={() => choose('server')}>{zh ? '保留伺服器' : 'Keep server'}</button>
      {list.length > 1 && <button className="btn ghost" onClick={() => setI((i + 1) % list.length)}>{zh ? '下一筆 ›' : 'Next ›'}</button>}
    </div>
  );
}
