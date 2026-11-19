import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Modal, run } from '../ui.jsx';

// 加入清單：選既有清單或建立新清單。body = { wine_nos } | { query } | { codes }
export function AddToList({ body, zh, onClose, defaultName = '' }) {
  const nav = useNavigate();
  const { data: lists } = useApi('/api/lists');
  const [target, setTarget] = useState('new');
  const [name, setName] = useState(defaultName);
  const go = async () => {
    if (target === 'new') {
      const r = await run(() => api('/api/lists', { method: 'POST', body: { ...body, name } }), (r) => (zh ? `已建立清單，${r.added} 款` : `List created with ${r.added} wines`));
      onClose(); nav('/lists/' + r.id);
    } else {
      await run(() => api(`/api/lists/${target}/items`, { method: 'POST', body }), (r) => (zh ? `已加入 ${r.added} 款` : `Added ${r.added}`));
      onClose();
    }
  };
  return (
    <Modal title={zh ? '加入清單' : 'Add to list'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={target === 'new' && !name.trim()} onClick={go}>{zh ? '確定' : 'OK'}</button></>}>
      <label className="check"><input type="radio" name="t" checked={target === 'new'} onChange={() => setTarget('new')} />{zh ? '建立新清單' : 'New list'}</label>
      {target === 'new' && <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={zh ? '清單名稱，例：給陳先生的推薦' : 'List name'} autoFocus />}
      {lists?.map((l) => <label className="check" key={l.id}><input type="radio" name="t" checked={target === l.id} onChange={() => setTarget(l.id)} />{l.name} <span className="muted small">（{l.wines} {zh ? '款' : 'wines'}）</span></label>)}
      <div className="muted small">{zh ? '清單的品項固定；數量與價格會顯示最新值。' : 'Items stay fixed; quantities and prices are always current.'}</div>
    </Modal>
  );
}

const STATUS = [['broken', '破損', 'Broken'], ['reserved', '保留', 'Reserved'], ['shipped', '已出貨', 'Shipped'], ['in_stock', '在庫', 'In stock']];
export function StatusModal({ bottle_nos, zh, onClose }) {
  const [status, setStatus] = useState('broken');
  const [reason, setReason] = useState('');
  const go = async () => {
    const r = await run(() => api('/api/bottles/status', { method: 'POST', body: { bottle_nos, status, reason } }), (r) => (zh ? `已變更 ${r.changed} 瓶` : `Changed ${r.changed}`));
    onClose(r.changed);
  };
  return (
    <Modal title={zh ? `變更 ${bottle_nos.length} 瓶的狀態` : `Change status of ${bottle_nos.length} bottles`} onClose={() => onClose(0)}
      footer={<><button className="btn" onClick={() => onClose(0)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={status !== 'in_stock' && !reason.trim()} onClick={go}>{zh ? '確定' : 'OK'}</button></>}>
      <div className="radio-cards">{STATUS.map(([k, a, b]) => <label key={k} className={status === k ? 'on' : ''}><input type="radio" checked={status === k} onChange={() => setStatus(k)} />{zh ? a : b}</label>)}</div>
      <label className="f">{zh ? '原因' : 'Reason'}{status !== 'in_stock' ? ' *' : ''}<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={zh ? '例：搬運破損、客戶試飲' : 'e.g. broken in transit'} /></label>
      <div className="muted small">{zh ? '出貨請在第二期用訂單處理；這裡用於破損、保留或更正。' : 'Sales go through orders (phase 2).'}</div>
    </Modal>
  );
}

// ===== 出庫（不經過訂單）=====
export const OUT_REASONS = [['own', '自用', 'Own use'], ['gift', '贈送', 'Gift'], ['tasting', '試飲', 'Tasting'], ['broken', '破損', 'Broken'], ['shortage', '盤點短少', 'Count shortage'], ['mistake', '輸入錯誤', 'Entry error'], ['other', '其他', 'Other']];
export function ReasonPicker({ reason, setReason, note, setNote, zh }) {
  return (
    <>
      <div className="radio-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>{OUT_REASONS.map(([k, a, b]) => (
        <label key={k} className={reason === k ? 'on' : ''}><input type="radio" name="outreason" checked={reason === k} onChange={() => setReason(k)} />{zh ? a : b}</label>))}</div>
      <label className="f">{zh ? '說明' : 'Note'}{reason === 'other' ? ' *' : (zh ? '（選填）' : ' (optional)')}<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={zh ? '例：送王董、週五品酒會' : 'e.g. gift for a client'} /></label>
    </>
  );
}
export function StockoutModal({ bottle_nos = [], case_nos = [], count, zh, onClose }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const n = count ?? bottle_nos.length;
  const go = async () => {
    const r = await run(() => api('/api/stockout', { method: 'POST', body: { bottle_nos, case_nos, reason, note } }), (r) => (zh ? `已出庫 ${r.count} 瓶` : `${r.count} bottles removed`));
    onClose(r.count);
  };
  return (
    <Modal title={zh ? `出庫${n ? ` ${n} 瓶` : ''}${case_nos.length ? `（酒箱 ${case_nos.join('、')}）` : ''}` : 'Remove from stock'} onClose={() => onClose(0)}
      footer={<><button className="btn" onClick={() => onClose(0)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!reason || (reason === 'other' && !note.trim())} onClick={go}>{zh ? '確認出庫' : 'Remove'}</button></>}>
      <ReasonPicker reason={reason} setReason={setReason} note={note} setNote={setNote} zh={zh} />
      <div className="muted small">{zh ? '出庫的酒不再算庫存，但紀錄會保留，並記入異動紀錄。要賣給客戶請用訂單。放錯可在酒款頁「變更狀態」改回在庫。' : 'Bottles leave stock but their record is kept. Use an order for sales.'}</div>
    </Modal>
  );
}
