// 手機離線：資料副本（IndexedDB）＋操作佇列＋同步
import { useEffect, useState } from 'react';

const DB = 'mywines', VER = 1;
let dbp;
function idb() {
  if (!dbp) dbp = new Promise((ok, no) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('ops', { keyPath: 'id' }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await idb();
  return new Promise((ok, no) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => ok(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => no(t.error);
  });
}
const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
const opsAll = () => tx('ops', 'readonly', (s) => s.getAll());
const opPut = (op) => tx('ops', 'readwrite', (s) => s.put(op));
const opDel = (id) => tx('ops', 'readwrite', (s) => s.delete(id));

export function deviceId() {
  let id = localStorage.getItem('device');
  if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); localStorage.setItem('device', id); }
  return id;
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2));

// ===== 狀態（給畫面訂閱）=====
const state = { online: navigator.onLine, pending: 0, ops: [], lastSync: localStorage.getItem('lastSync') || null, conflicts: Number(localStorage.getItem('conflicts') || 0), syncing: false, snap: null, error: null };
const subs = new Set();
const emit = () => subs.forEach((f) => f({ ...state }));
export function useOffline() {
  const [s, set] = useState({ ...state });
  useEffect(() => { subs.add(set); set({ ...state }); return () => subs.delete(set); }, []);
  return s;
}

let snapCache = null;
export async function snapshot() {
  if (snapCache) return snapCache;
  snapCache = (await kvGet('snapshot')) || null;
  if (snapCache) index(snapCache);
  state.snap = snapCache && { at: snapCache.at, bottles: snapCache.bottles.length, cases: snapCache.cases.length, wines: snapCache.wines.length };
  return snapCache;
}
// 建索引，方便查詢
function index(s) {
  s.byBottle = new Map(s.bottles.map((b) => [b.bottle_no, b]));
  s.byWineId = new Map(s.wines.map((w) => [w.id, w]));
  s.byWineNo = new Map(s.wines.map((w) => [w.wine_no, w]));
  s.byCase = new Map(s.cases.map((c) => [c.case_no, c]));
  s.byRack = new Map(s.racks.map((r) => [r.id, r]));
  s.byLocker = new Map(s.lockers.map((l) => [l.id, l]));
  s.byCellar = new Map(s.cellars.map((c) => [c.id, c]));
}
export function rackLabel(s, rackId) {
  const r = s.byRack.get(rackId); if (!r) return '—';
  const l = s.byLocker.get(r.locker_id); const c = l && s.byCellar.get(l.cellar_id);
  return `${c?.name || ''} › ${l?.code || ''} › ${r.code}`;
}
export const lockerOf = (s, rackId) => s.byLocker.get(s.byRack.get(rackId)?.locker_id);

async function ping() {
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('/api/me', { signal: ctl.signal, cache: 'no-store' }); clearTimeout(tm);
    return r.status === 200 ? 'ok' : r.status === 401 ? 'auth' : 'down';
  } catch { return 'down'; }
}

export async function refreshSnapshot() {
  const r = await fetch('/api/offline/snapshot', { cache: 'no-store' });
  if (!r.ok) throw new Error('無法下載資料');
  const s = await r.json();
  // 重新套用還沒同步的操作，讓畫面顯示手機上的最新狀態
  const ops = await opsAll();
  index(s);
  for (const op of ops.sort((a, b) => a.ts.localeCompare(b.ts))) applyLocal(s, op);
  const { byBottle, byWineId, byWineNo, byCase, byRack, byLocker, byCellar, ...plain } = s;
  await kvSet('snapshot', plain);
  snapCache = s;
  state.snap = { at: s.at, bottles: s.bottles.length, cases: s.cases.length, wines: s.wines.length };
  emit();
  return s;
}

// 先在手機上套用（離線時畫面也正確）
function applyLocal(s, op) {
  const p = op.payload;
  if (op.type === 'move_bottles') {
    for (const no of p.bottle_nos) {
      const b = s.byBottle.get(no); if (!b) continue;
      if (p.dest.mode === 'case') { const c = s.byCase.get(p.dest.case_no); if (c) { b.case_no = c.case_no; b.rack_id = c.rack_id; } }
      else if (p.dest.mode === 'newcase') { b.case_no = '（新酒箱）'; b.rack_id = Number(p.dest.rack_id); }
      else { b.case_no = null; b.rack_id = Number(p.dest.rack_id); }
    }
  } else if (op.type === 'move_case') {
    const c = s.byCase.get(p.case_no); if (c) { c.rack_id = Number(p.rack_id); c.uncertain = 0; }
    for (const b of s.bottles) if (b.case_no === p.case_no) b.rack_id = Number(p.rack_id);
  } else if (op.type === 'status') {
    for (const no of p.bottle_nos) { const b = s.byBottle.get(no); if (b) b.status = p.status; }
  } else if (op.type === 'stockout') {
    for (const no of p.bottle_nos) { const b = s.byBottle.get(no); if (b) b.status = p.reason === 'broken' ? 'broken' : 'out'; }
  }
}

export async function queueOp(type, payload) {
  const s = await snapshot();
  let base = {};
  if (s && (type === 'move_bottles' || type === 'status' || type === 'stockout')) base = { bottles: Object.fromEntries(payload.bottle_nos.map((no) => { const b = s.byBottle.get(no); return [no, b ? { rack_id: b.rack_id, case_no: b.case_no, status: b.status } : null]; })) };
  if (s && type === 'move_case') base = { rack_id: s.byCase.get(payload.case_no)?.rack_id };
  const op = { id: uuid(), ts: new Date().toISOString(), type, payload, base, user: localStorage.getItem('meLogin') };
  await opPut(op);
  if (s) {
    applyLocal(s, op);
    const { byBottle, byWineId, byWineNo, byCase, byRack, byLocker, byCellar, ...plain } = s;
    await kvSet('snapshot', plain);
  }
  await loadOps();
  sync();
  return op;
}

async function loadOps() { state.ops = (await opsAll()).sort((a, b) => a.ts.localeCompare(b.ts)); state.pending = state.ops.length; emit(); }

let syncing = null;
export function sync({ refresh = true } = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    state.syncing = true; emit();
    try {
      const p = await ping();
      state.online = p !== 'down';
      if (p !== 'ok') { emit(); return { online: state.online }; }
      const ops = (await opsAll()).sort((a, b) => a.ts.localeCompare(b.ts));
      let conflicts = 0, applied = 0, rejected = [];
      if (ops.length) {
        const r = await fetch('/api/offline/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: deviceId(), ops }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '同步失敗');
        const { results } = await r.json();
        for (const x of results) {
          await opDel(x.id);
          if (x.status === 'conflict') conflicts++; else if (x.status === 'rejected') rejected.push(x.error); else applied++;
        }
      }
      const cr = await fetch('/api/offline/conflicts', { cache: 'no-store' });
      state.conflicts = cr.ok ? (await cr.json()).length : conflicts;
      localStorage.setItem('conflicts', state.conflicts);
      if (refresh) await refreshSnapshot();
      state.lastSync = new Date().toISOString(); localStorage.setItem('lastSync', state.lastSync);
      state.error = rejected.length ? rejected.join('；') : null;
      await loadOps();
      return { online: true, applied, conflicts, rejected };
    } catch (e) { state.error = e.message; emit(); return { online: state.online, error: e.message }; }
    finally { state.syncing = false; syncing = null; emit(); }
  })();
  return syncing;
}

export async function clearLocal() {
  const d = await idb();
  await new Promise((ok) => { const t = d.transaction(['kv', 'ops'], 'readwrite'); t.objectStore('kv').clear(); t.objectStore('ops').clear(); t.oncomplete = ok; });
  snapCache = null; state.snap = null; state.pending = 0; state.ops = [];
  localStorage.removeItem('lastSync'); localStorage.removeItem('conflicts');
  emit();
}

let started = false;
export function startOffline() {
  if (started) return; started = true;
  loadOps().then(snapshot).then(() => sync());
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => { state.online = false; emit(); });
  setInterval(() => { if (document.visibilityState === 'visible' && (state.pending || !state.online)) sync({ refresh: state.pending > 0 || !state.online }); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const stale = !state.lastSync || Date.now() - new Date(state.lastSync).getTime() > 120000;
    sync({ refresh: stale || state.pending > 0 });
  });
}
export const pendingCount = () => state.pending;
