import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { snapshot, useOffline, rackLabel, lockerOf } from '../offline/store.js';

export function useSnap() {
  const st = useOffline();
  const [s, setS] = useState(null);
  useEffect(() => { snapshot().then(setS); }, [st.snap?.at, st.pending]);
  return [s, st];
}

const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
export function SyncPill({ zh = true }) {
  const st = useOffline();
  const cls = !st.online ? 'pill off' : st.conflicts ? 'pill err' : 'pill';
  const txt = !st.online ? (zh ? '離線' : 'Offline') : st.syncing ? (zh ? '同步中' : 'Syncing') : (zh ? '已連線' : 'Online');
  return (
    <Link to="/m/sync" className={cls} title={zh ? '同步狀態' : 'Sync status'}>
      <span className="dot" />{txt}
      {st.pending > 0 && <> · {zh ? `待同步 ${st.pending} 筆` : `${st.pending} pending`}</>}
      {st.conflicts > 0 && <> · {zh ? `衝突 ${st.conflicts}` : `${st.conflicts} conflicts`}</>}
      {!st.pending && st.lastSync && <> · {hhmm(st.lastSync)}</>} ›
    </Link>
  );
}

export function MHead({ title, back = -1, right }) {
  return (
    <div className="mhead">
      {back !== null && <Link className="back" to={typeof back === 'string' ? back : '..'} onClick={(e) => { if (back === -1) { e.preventDefault(); history.back(); } }} aria-label="返回">‹</Link>}
      <h1 style={{ flex: 1 }}>{title}</h1>{right}
    </div>
  );
}

// 代碼 → 物件（離線，用手機上的資料）
export function resolveLocal(s, raw) {
  const code = String(raw || '').trim().replace(/^MW:/i, '');
  let m;
  if ((m = code.match(/^(?:RACK|R):(\d+)$/i))) { const r = s.byRack.get(Number(m[1])); return r ? { type: 'rack', id: r.id, rack: r, label: rackLabel(s, r.id) } : null; }
  if ((m = code.match(/^(?:LOCKER|L):(\d+)$/i))) { const l = s.byLocker.get(Number(m[1])); return l ? { type: 'locker', id: l.id, locker: l, label: `${s.byCellar.get(l.cellar_id)?.name} › ${l.code}` } : null; }
  const caseNo = code.replace(/^(?:CASE|C):/i, '');
  const c = s.byCase.get(caseNo);
  if (c) { const bottles = s.bottles.filter((b) => b.case_no === c.case_no && b.status === 'in_stock'); return { type: 'case', case_no: c.case_no, c, bottles, label: rackLabel(s, c.rack_id), wine: s.byWineId.get(bottles[0]?.wine_id) }; }
  const b = s.byBottle.get(code.toUpperCase());
  if (b) return { type: 'bottle', bottle_no: b.bottle_no, b, wine: s.byWineId.get(b.wine_id), label: rackLabel(s, b.rack_id) };
  const w = s.byWineNo.get(code.toUpperCase());
  if (w) return { type: 'wine', wine_no: w.wine_no, w };
  return null;
}
export { rackLabel, lockerOf };

export function ManualInput({ onCode, zh = true, placeholder }) {
  const [v, setV] = useState('');
  return (
    <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onCode(v.trim()); setV(''); } }}>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder || (zh ? '手動輸入編號' : 'Type a code')} autoCapitalize="characters" />
      <button className="btn">{zh ? '查詢' : 'Go'}</button>
    </form>
  );
}

export function describeOp(s, op, zh = true) {
  const p = op.payload;
  if (op.type === 'move_bottles') {
    const to = p.dest.mode === 'case' ? `酒箱 ${p.dest.case_no}` : (p.dest.mode === 'newcase' ? '新酒箱 @ ' : '') + (s ? rackLabel(s, Number(p.dest.rack_id)) : '');
    return { title: zh ? `移動 ${p.bottle_nos.length} 瓶` : `Move ${p.bottle_nos.length} bottles`, sub: `${p.bottle_nos.slice(0, 3).join(', ')}${p.bottle_nos.length > 3 ? '…' : ''} → ${to}` };
  }
  if (op.type === 'move_case') return { title: (zh ? '移動酒箱 ' : 'Move case ') + p.case_no, sub: '→ ' + (s ? rackLabel(s, Number(p.rack_id)) : '') };
  if (op.type === 'status') return { title: (zh ? '標記' : 'Mark ') + ({ broken: '破損', reserved: '保留', in_stock: '在庫', shipped: '已出貨' }[p.status] || p.status) + ' ' + p.bottle_nos.join(', '), sub: (zh ? '原因：' : 'Reason: ') + (p.reason || '—') };
  if (op.type === 'stockout') return { title: (zh ? `出庫 ${p.bottle_nos.length} 瓶` : `Remove ${p.bottle_nos.length}`), sub: `${{ own: '自用', gift: '贈送', tasting: '試飲', broken: '破損', shortage: '盤點短少', mistake: '輸入錯誤', other: '其他' }[p.reason] || ''}${p.note ? '：' + p.note : ''} · ${p.bottle_nos.slice(0, 3).join(', ')}${p.bottle_nos.length > 3 ? '…' : ''}` };
  if (op.type === 'list_create') return { title: (zh ? '新清單「' : 'New list "') + p.name + (zh ? '」' : '"'), sub: `${p.codes.length} ${zh ? '項' : 'items'}` };
  if (op.type === 'count') { const l = s?.byLocker.get(Number(p.locker_id)); return { title: (zh ? '盤點 ' : 'Count ') + (l?.code || ''), sub: (zh ? `掃到 ${p.codes.length} 項，回公司產生差異報告` : `${p.codes.length} scanned`) }; }
  return { title: op.type, sub: '' };
}
