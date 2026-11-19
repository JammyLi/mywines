import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, num } from '../api.js';
import { useApi } from '../hooks.js';
import { useT } from '../i18n.jsx';
import { Modal, download, run, toast } from '../ui.jsx';
import { Changes } from './parts.jsx';
import { bookmarkletCode } from './Prices.jsx';
import { reloadCompany } from '../company.js';
import ServerInfo from './ServerInfo.jsx';
import VersionInfo from './VersionInfo.jsx';

const ACT = { new: ['新增', 'New'], update: ['修改', 'Update'], same: ['不變', 'No change'], error: ['錯誤', 'Error'] };

export function BatchBar({ kind, label, zh, onDone }) {
  const ref = useRef();
  const [prev, setPrev] = useState(null);
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    setPrev(await run(() => api(`/api/batch/${kind}/preview`, { method: 'POST', body: fd })));
  };
  const commit = async () => {
    await run(() => api(`/api/batch/${kind}/commit`, { method: 'POST', body: { token: prev.token } }), (r) => (zh ? `已寫入 ${r.applied} 筆` : `Applied ${r.applied}`));
    setPrev(null); onDone();
  };
  const todo = prev ? prev.counts.new + prev.counts.update : 0;
  return (
    <div className="row">
      <button className="btn mini" onClick={() => run(() => download(`/api/batch/${kind}/template`, null, 'template.xlsx'))}>{zh ? '下載範本' : 'Template'}</button>
      <button className="btn mini" onClick={() => ref.current.click()}>{zh ? '上傳 Excel' : 'Upload Excel'}</button>
      <button className="btn mini" onClick={() => run(() => download(`/api/batch/${kind}/export`, null, 'export.xlsx'))}>{zh ? '匯出 Excel' : 'Export Excel'}</button>
      <input ref={ref} type="file" accept=".xlsx" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
      {prev && (
        <Modal wide title={(zh ? '上傳預覽：' : 'Upload preview: ') + label} onClose={() => setPrev(null)}
          footer={<><button className="btn" onClick={() => setPrev(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!todo} onClick={commit}>{zh ? `寫入 ${todo} 筆` : `Apply ${todo}`}</button></>}>
          <div className="row">{Object.entries(prev.counts).map(([k, n]) => <span key={k} className={'tag status-' + k}>{ACT[k][zh ? 0 : 1]} {n}</span>)}</div>
          {prev.counts.error > 0 && <div className="alert">{zh ? '有錯誤的列不會寫入；修正後可再上傳一次。' : 'Rows with errors are skipped.'}</div>}
          <div className="tbl-wrap"><table className="tbl stack">
            <thead><tr><th>{zh ? '列' : 'Row'}</th><th>{zh ? '動作' : 'Action'}</th><th>{zh ? '項目' : 'Item'}</th><th>{zh ? '內容' : 'Details'}</th></tr></thead>
            <tbody>{prev.rows.map((r) => <tr key={r.line}><td className="muted">{r.line}</td><td className={'status-' + r.action}><b>{ACT[r.action][zh ? 0 : 1]}</b></td><td>{r.key}<div className="sub">{r.label}</div></td>
              <td>{r.error ? <span style={{ color: 'var(--err)' }}>{r.error}</span> : r.changes ? <Changes json={JSON.stringify(r.changes)} /> : ''}</td></tr>)}</tbody>
          </table></div>
        </Modal>
      )}
    </div>
  );
}

function Section({ title, sub, kind, zh, onDone, actions, children }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row between"><div><h2 style={{ margin: 0 }}>{title}</h2>{sub && <div className="muted small" style={{ marginTop: 4 }}>{sub}</div>}</div>
        <div className="row">{kind && <BatchBar kind={kind} label={title} zh={zh} onDone={onDone} />}{actions}</div></div>
      {children}
    </div>
  );
}

function Company({ zh }) {
  const [v, setV] = useState(0);
  const { data } = useApi('/api/settings?v=' + v);
  const [f, setF] = useState(null);
  const ref = useRef();
  useEffect(() => { if (data) setF(data.company); }, [data]);
  if (!f) return null;
  const fld = (k, l) => <label className="f">{l}<input className="input" value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Section title={zh ? '公司資料' : 'Company'} sub={zh ? '暫定資料，之後更換。用於匯出 PDF 的抬頭。' : 'Placeholder details, used on PDF exports.'} zh={zh}>
      <div className="row">
        {f.logo ? <img src={'/api/photo/' + f.logo} alt="Logo" style={{ height: 48, border: '1px solid var(--line)', borderRadius: 6, padding: 4 }} /> : <span className="tag">Logo</span>}
        <button className="btn mini" onClick={() => ref.current.click()}>{zh ? '上傳 PNG / SVG' : 'Upload PNG / SVG'}</button>
        <input ref={ref} type="file" accept="image/png,image/svg+xml,image/jpeg" hidden onChange={async (e) => { const fd = new FormData(); fd.append('logo', e.target.files[0]); await run(() => api('/api/settings/logo', { method: 'POST', body: fd }), zh ? '已更新 Logo' : 'Logo updated'); setV(v + 1); reloadCompany(); }} />
      </div>
      <div className="grid g2" style={{ gap: 12 }}>
        {fld('name_zh', zh ? '公司名稱（中）' : 'Name (Chinese)')}{fld('name_en', zh ? '公司名稱（英）' : 'Name (English)')}
        {fld('tax_id', zh ? '統一編號' : 'Tax ID')}{fld('phone', zh ? '電話' : 'Phone')}
        {fld('address', zh ? '地址' : 'Address')}{fld('email', 'Email')}{fld('tax_rate', zh ? '稅率 %' : 'Tax rate %')}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={async () => { await run(() => api('/api/settings/company', { method: 'PUT', body: f }), zh ? '已儲存公司資料' : 'Saved'); reloadCompany(); }}>{zh ? '儲存公司資料' : 'Save'}</button></div>
      <ServerInfo zh={zh} />
      <VersionInfo zh={zh} />
    </Section>
  );
}

function Users({ zh }) {
  const [v, setV] = useState(0);
  const { data: users } = useApi('/api/users?v=' + v);
  const { data: me } = useApi('/api/me');
  const [add, setAdd] = useState(null);
  const [pw, setPw] = useState(null);
  const reload = () => setV(v + 1);
  return (
    <Section title={zh ? '使用者' : 'Users'} sub={zh ? '以登入名稱 + 6 位數字密碼登入；不分角色，所有操作記入異動紀錄。' : 'Login name + 6-digit password. No roles; everything is logged.'} kind="users" zh={zh} onDone={reload}
      actions={<button className="btn primary mini" onClick={() => setAdd({ login: '', name: '', password: '' })}>{zh ? '＋ 新增使用者' : '+ Add user'}</button>}>
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr><th>{zh ? '登入名稱' : 'Login'}</th><th>{zh ? '姓名' : 'Name'}</th><th>{zh ? '介面語言' : 'Language'}</th><th>{zh ? '狀態' : 'Status'}</th><th>{zh ? '最後登入' : 'Last login'}</th><th>{zh ? '動作' : 'Actions'}</th></tr></thead>
        <tbody>{users?.map((u) => (
          <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
            <td><b>{u.login}</b>{me?.id === u.id && <span className="tag" style={{ marginLeft: 6 }}>{zh ? '我' : 'me'}</span>}</td>
            <td><input className="input" style={{ minHeight: 32 }} defaultValue={u.name || ''} onBlur={(e) => e.target.value !== (u.name || '') && run(() => api('/api/users/' + u.id, { method: 'PUT', body: { name: e.target.value } }), zh ? '已儲存' : 'Saved')} aria-label={zh ? '姓名' : 'Name'} /></td>
            <td><select className="input" style={{ minHeight: 32, width: 'auto' }} value={u.lang} onChange={async (e) => { await run(() => api('/api/users/' + u.id, { method: 'PUT', body: { lang: e.target.value } })); reload(); }}><option value="zh">繁體中文</option><option value="en">English</option></select></td>
            <td>{u.active ? <span className="tag ok">{zh ? '啟用' : 'Active'}</span> : <span className="tag">{zh ? '停用' : 'Inactive'}</span>}{u.locked_until && <span className="tag warn" style={{ marginLeft: 4 }}>{zh ? '鎖定中' : 'Locked'}</span>}</td>
            <td className="muted small">{u.last_login || '—'}</td>
            <td><div className="row" style={{ gap: 4 }}>
              <button className="btn mini" onClick={() => setPw({ u, password: '' })}>{zh ? '重設密碼' : 'Reset password'}</button>
              {me?.id !== u.id && <button className="btn mini" onClick={async () => { await run(() => api('/api/users/' + u.id, { method: 'PUT', body: { active: !u.active } }), zh ? '已更新' : 'Updated'); reload(); }}>{u.active ? (zh ? '停用' : 'Deactivate') : (zh ? '啟用' : 'Activate')}</button>}
            </div></td>
          </tr>))}</tbody></table></div>
      <div className="muted small">{zh ? '登入名稱建立後不能修改；離職請改為「停用」，不會刪除，以保留其異動紀錄。密碼不會顯示在任何畫面或匯出檔。' : 'Login names cannot change. Deactivate instead of deleting so the change log stays intact. Passwords are never shown or exported.'}</div>
      {add && (
        <Modal title={zh ? '新增使用者' : 'Add user'} onClose={() => setAdd(null)}
          footer={<><button className="btn" onClick={() => setAdd(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!add.login || !/^\d{6}$/.test(add.password)} onClick={async () => { await run(() => api('/api/users', { method: 'POST', body: add }), zh ? '已建立使用者' : 'User created'); setAdd(null); reload(); }}>{zh ? '建立' : 'Create'}</button></>}>
          <label className="f">{zh ? '登入名稱' : 'Login name'}<input className="input" autoCapitalize="none" value={add.login} onChange={(e) => setAdd({ ...add, login: e.target.value.trim() })} /></label>
          <label className="f">{zh ? '姓名（選填）' : 'Name (optional)'}<input className="input" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
          <label className="f">{zh ? '密碼（6 位數字）' : 'Password (6 digits)'}<input className="input" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value.replace(/\D/g, '') })} /></label>
        </Modal>
      )}
      {pw && (
        <Modal title={(zh ? '重設密碼：' : 'Reset password: ') + pw.u.login} onClose={() => setPw(null)}
          footer={<><button className="btn" onClick={() => setPw(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!/^\d{6}$/.test(pw.password)} onClick={async () => { await run(() => api(`/api/users/${pw.u.id}/password`, { method: 'POST', body: { password: pw.password } }), zh ? '已重設密碼' : 'Password reset'); setPw(null); reload(); }}>{zh ? '重設' : 'Reset'}</button></>}>
          <label className="f">{zh ? '新密碼（6 位數字）' : 'New password (6 digits)'}<input className="input" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value.replace(/\D/g, '') })} /></label>
          <div className="muted small">{zh ? '請當面或電話告訴對方，不要寫在聊天群組。重設後，對方其他裝置需重新登入。' : 'Tell them in person. Their other devices will be signed out.'}</div>
        </Modal>
      )}
    </Section>
  );
}

function Customers({ zh }) {
  const [v, setV] = useState(0);
  const { data } = useApi('/api/customers?v=' + v);
  const [edit, setEdit] = useState(null);
  const reload = () => setV(v + 1);
  const save = async () => {
    if (edit.id) await run(() => api('/api/customers/' + edit.id, { method: 'PUT', body: edit }), zh ? '已儲存' : 'Saved');
    else await run(() => api('/api/customers', { method: 'POST', body: edit }), (r) => (zh ? `已新增 ${r.customer_no}` : `Added ${r.customer_no}`));
    setEdit(null); reload();
  };
  const fld = (k, l, p = {}) => <label className="f">{l}<input className="input" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} {...p} /></label>;
  return (
    <Section title={zh ? '客戶' : 'Customers'} sub={zh ? '點客戶名稱可看歷史訂單、各酒款成交價與送貨地址。' : 'Click a name for orders, prices and addresses.'} kind="customers" zh={zh} onDone={reload}
      actions={<button className="btn primary mini" onClick={() => setEdit({ name: '', kind: '個人', lang: 'zh' })}>{zh ? '＋ 新增客戶' : '+ Add customer'}</button>}>
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr><th>{zh ? '客戶編號' : 'No.'}</th><th>{zh ? '名稱' : 'Name'}</th><th>{zh ? '類型' : 'Kind'}</th><th>{zh ? '聯絡人 / 電話' : 'Contact'}</th><th>{zh ? '偏好語言' : 'Language'}</th><th className="num">{zh ? '預設折扣' : 'Discount'}</th><th>{zh ? '備註' : 'Note'}</th><th></th></tr></thead>
        <tbody>{data?.map((c) => <tr key={c.id} style={{ opacity: c.active ? 1 : 0.55 }}><td>{c.customer_no}</td><td><Link to={'/customers/' + c.id}><b>{c.name}</b></Link>{c.tax_id && <div className="sub">{zh ? '統編' : 'Tax ID'} {c.tax_id}</div>}</td><td>{c.kind}</td>
          <td>{c.contact}<div className="sub">{c.phone}</div></td><td>{c.lang === 'en' ? 'English' : '繁體中文'}</td><td className="num">{c.discount != null ? c.discount + '%' : '—'}</td><td className="small">{c.note}</td>
          <td><button className="btn mini" onClick={() => setEdit(c)}>{zh ? '編輯' : 'Edit'}</button></td></tr>)}</tbody></table></div>
      {data && !data.length && <div className="muted small">{zh ? '還沒有客戶。可以一筆筆新增，或下載範本後批次上傳。' : 'No customers yet.'}</div>}
      {edit && (
        <Modal wide title={edit.id ? edit.customer_no + ' ' + edit.name : (zh ? '新增客戶' : 'Add customer')} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!edit.name?.trim()} onClick={save}>{zh ? '儲存' : 'Save'}</button></>}>
          <div className="grid g2" style={{ gap: 12 }}>
            {fld('name', zh ? '名稱 *' : 'Name *')}
            <label className="f">{zh ? '類型' : 'Kind'}<select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option>個人</option><option>公司</option></select></label>
            {fld('tax_id', zh ? '統一編號' : 'Tax ID')}{fld('contact', zh ? '聯絡人' : 'Contact')}{fld('phone', zh ? '電話' : 'Phone', { inputMode: 'tel' })}{fld('email', 'Email', { inputMode: 'email' })}
            {fld('address', zh ? '地址' : 'Address')}
            <label className="f">{zh ? '偏好語言' : 'Language'}<select className="input" value={edit.lang} onChange={(e) => setEdit({ ...edit, lang: e.target.value })}><option value="zh">繁體中文</option><option value="en">English</option></select></label>
            {fld('discount', zh ? '預設折扣 %' : 'Discount %', { inputMode: 'decimal' })}{fld('note', zh ? '備註' : 'Note')}
          </div>
          {edit.id && <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />{zh ? '啟用' : 'Active'}</label>}
        </Modal>
      )}
    </Section>
  );
}

function Merchants({ zh }) {
  const [v, setV] = useState(0);
  const { data } = useApi('/api/merchants?v=' + v);
  const [edit, setEdit] = useState(null);
  const [merge, setMerge] = useState(null);
  const reload = () => setV(v + 1);
  const save = async () => {
    if (edit.id) await run(() => api('/api/merchants/' + edit.id, { method: 'PUT', body: edit }), zh ? '已儲存' : 'Saved');
    else await run(() => api('/api/merchants', { method: 'POST', body: edit }), zh ? '已新增' : 'Added');
    setEdit(null); reload();
  };
  return (
    <Section title={zh ? '酒商' : 'Merchants'} kind="merchants" zh={zh} onDone={reload}
      actions={<><button className="btn mini" onClick={() => setMerge({ from_id: '', to_id: '' })}>{zh ? '合併酒商' : 'Merge'}</button><button className="btn primary mini" onClick={() => setEdit({ name: '' })}>{zh ? '＋ 新增酒商' : '+ Add merchant'}</button></>}>
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr><th>{zh ? '名稱' : 'Name'}</th><th>{zh ? '類型' : 'Kind'}</th><th className="num">{zh ? '庫存箱數' : 'Cases'}</th><th className="num">{zh ? '在庫瓶數' : 'Bottles'}</th><th>{zh ? '聯絡資訊' : 'Contact'}</th><th></th></tr></thead>
        <tbody>{data?.map((m) => <tr key={m.id}><td><b>{m.name}</b></td><td>{m.kind || <span className="muted">{zh ? '未設定' : '—'}</span>}</td><td className="num">{m.cases}</td><td className="num">{m.bottles}</td>
          <td className="small">{[m.contact, m.phone, m.email].filter(Boolean).join(' · ') || '—'}</td><td><button className="btn mini" onClick={() => setEdit(m)}>{zh ? '編輯' : 'Edit'}</button></td></tr>)}</tbody></table></div>
      {edit && (
        <Modal title={edit.id ? edit.name : (zh ? '新增酒商' : 'Add merchant')} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!edit.name?.trim()} onClick={save}>{zh ? '儲存' : 'Save'}</button></>}>
          {[['name', zh ? '名稱 *' : 'Name *'], ['kind', zh ? '類型（進口商、酒莊直購…）' : 'Kind'], ['contact', zh ? '聯絡人' : 'Contact'], ['phone', zh ? '電話' : 'Phone'], ['email', 'Email'], ['note', zh ? '備註' : 'Note']].map(([k, l]) => (
            <label className="f" key={k}>{l}<input className="input" value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>))}
        </Modal>
      )}
      {merge && (
        <Modal title={zh ? '合併酒商' : 'Merge merchants'} onClose={() => setMerge(null)}
          footer={<><button className="btn" onClick={() => setMerge(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!merge.from_id || !merge.to_id || merge.from_id === merge.to_id}
            onClick={async () => { await run(() => api('/api/merchants/merge', { method: 'POST', body: merge }), (r) => (zh ? `已合併，移轉 ${r.moved} 筆採購批次` : `Merged ${r.moved} lots`)); setMerge(null); reload(); }}>{zh ? '執行合併' : 'Merge'}</button></>}>
          <label className="f">{zh ? '把這個酒商…' : 'Merge this…'}<select className="input" value={merge.from_id} onChange={(e) => setMerge({ ...merge, from_id: e.target.value })}><option value="">—</option>{data?.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.bottles}）</option>)}</select></label>
          <label className="f">{zh ? '…合併到' : '…into'}<select className="input" value={merge.to_id} onChange={(e) => setMerge({ ...merge, to_id: e.target.value })}><option value="">—</option>{data?.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.bottles}）</option>)}</select></label>
          <div className="muted small">{zh ? '前者的採購紀錄會改到後者名下，前者刪除。會記入異動紀錄。' : 'The first merchant’s purchases move to the second, then it is removed.'}</div>
        </Modal>
      )}
    </Section>
  );
}

function Types({ zh }) {
  const [v, setV] = useState(0);
  const { data } = useApi('/api/types?v=' + v);
  const [edit, setEdit] = useState(null);
  const [mapTo, setMapTo] = useState('');
  const reload = () => setV(v + 1);
  const save = async () => {
    if (edit.isNew) await run(() => api('/api/types', { method: 'POST', body: edit }), zh ? '已新增' : 'Added');
    else if (mapTo) await run(() => api('/api/types/' + edit.code, { method: 'PUT', body: { merge_into: mapTo } }), (r) => (zh ? `已把 ${r.moved} 款酒改為新種類` : `Moved ${r.moved} wines`));
    else await run(() => api('/api/types/' + edit.code, { method: 'PUT', body: edit }), zh ? '已儲存' : 'Saved');
    setEdit(null); setMapTo(''); reload();
  };
  return (
    <Section title={zh ? '種類 Wine Types' : 'Wine types'} sub={zh ? '中英名稱依術語對照表；「匯入代碼」用來對應 Excel 裡的簡寫。' : 'Names follow the glossary; the code maps the Excel abbreviation.'} kind="types" zh={zh} onDone={reload}
      actions={<button className="btn primary mini" onClick={() => setEdit({ isNew: true, code: '', zh: '', en: '' })}>{zh ? '＋ 新增用語' : '+ Add type'}</button>}>
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr><th>{zh ? '匯入代碼' : 'Code'}</th><th>{zh ? '中文' : 'Chinese'}</th><th>English</th><th className="num">{zh ? '使用中（瓶）' : 'Bottles'}</th><th></th></tr></thead>
        <tbody>{data?.map((x) => <tr key={x.code}><td><b>{x.code}</b></td><td>{x.zh}{!x.mapped && <span className="tag warn" style={{ marginLeft: 6 }}>{zh ? '待對應' : 'Unmapped'}</span>}</td><td>{x.en}</td><td className="num">{num(x.bottles)}</td>
          <td><button className="btn mini" onClick={() => setEdit(x)}>{x.mapped ? (zh ? '編輯' : 'Edit') : (zh ? '對應' : 'Map')}</button></td></tr>)}</tbody></table></div>
      {edit && (
        <Modal title={edit.isNew ? (zh ? '新增種類' : 'Add type') : edit.code} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!mapTo && (!edit.code || !edit.zh || !edit.en)} onClick={save}>{zh ? '儲存' : 'Save'}</button></>}>
          {edit.isNew && <label className="f">{zh ? '匯入代碼' : 'Code'}<input className="input" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} maxLength={8} /></label>}
          {!edit.isNew && <>
            <label className="f">{zh ? '併入現有種類（選填）' : 'Merge into an existing type (optional)'}<select className="input" value={mapTo} onChange={(e) => setMapTo(e.target.value)}><option value="">—</option>{data?.filter((x) => x.code !== edit.code && x.mapped).map((x) => <option key={x.code} value={x.code}>{x.code} {x.zh} {x.en}</option>)}</select></label>
            <div className="muted small">{zh ? `例：把「${edit.code}」的 ${edit.wines} 款酒全部改為「氣泡酒」，並移除這個代碼。或在下面直接改名稱。` : 'Moves all its wines to the chosen type and removes this code. Or rename it below.'}</div>
          </>}
          {!mapTo && <>
            <label className="f">{zh ? '中文' : 'Chinese'}<input className="input" value={edit.zh} onChange={(e) => setEdit({ ...edit, zh: e.target.value })} /></label>
            <label className="f">English<input className="input" value={edit.en} onChange={(e) => setEdit({ ...edit, en: e.target.value })} /></label>
          </>}
        </Modal>
      )}
    </Section>
  );
}

function Storage({ zh }) {
  const [v, setV] = useState(0);
  const { data } = useApi('/api/locations?v=' + v);
  const [edit, setEdit] = useState(null); // { table, id?, parent?, fields }
  const reload = () => setV(v + 1);
  const save = async () => {
    const { table, id, ...body } = edit;
    await run(() => api(`/api/${table}${id ? '/' + id : ''}`, { method: id ? 'PUT' : 'POST', body }), zh ? '已儲存' : 'Saved');
    setEdit(null); reload();
  };
  const del = async (table, id, label) => { if (confirm((zh ? '刪除 ' : 'Delete ') + label + '？')) { await run(() => api(`/api/${table}/${id}`, { method: 'DELETE' }), zh ? '已刪除' : 'Deleted'); reload(); } };
  return (
    <Section title={zh ? '儲位管理' : 'Storage'} sub={zh ? '酒窖 › 分儲空間 › 架子。只有空的儲位可以刪除。' : 'Cellar › Locker › Rack. Only empty places can be deleted.'} kind="storage" zh={zh} onDone={reload}
      actions={<button className="btn primary mini" onClick={() => setEdit({ table: 'cellars', name: '', kind: 'general' })}>{zh ? '＋ 新增酒窖' : '+ Add cellar'}</button>}>
      {data?.map((c) => (
        <div key={c.id} className="rackbox">
          <div className="row between"><b>{zh ? '酒窖' : 'Cellar'} {c.name}</b><div className="row" style={{ gap: 4 }}>
            <button className="btn mini" onClick={() => setEdit({ table: 'lockers', cellar_id: c.id, code: '' })}>{zh ? '＋ 分儲空間' : '+ Locker'}</button>
            <button className="btn mini" onClick={() => setEdit({ table: 'cellars', id: c.id, name: c.name, address: c.address || '', note: c.note || '' })}>{zh ? '編輯' : 'Edit'}</button>
            {!c.lockers.length && <button className="btn mini" onClick={() => del('cellars', c.id, c.name)}>{zh ? '刪除' : 'Delete'}</button>}</div></div>
          <div className="tbl-wrap" style={{ marginTop: 10 }}><table className="tbl stack">
            <thead><tr><th>{zh ? '分儲空間' : 'Locker'}</th><th>{zh ? '架子' : 'Racks'}</th><th></th></tr></thead>
            <tbody>{c.lockers.map((l) => (
              <tr key={l.id}><td><b>{l.code}</b>{l.note && <div className="sub">{l.note}</div>}</td>
                <td><div className="chips">{l.racks.map((r) => <span key={r.id} className="chip" style={{ background: r.is_default ? 'var(--warn-bg)' : undefined, color: r.is_default ? 'var(--warn)' : undefined }}>{r.code} · {r.n}
                  {!r.n && !r.cases && !r.is_default ? <button onClick={() => del('racks', r.id, r.code)} aria-label={zh ? '刪除' : 'Delete'}>×</button> : <button onClick={() => setEdit({ table: 'racks', id: r.id, code: r.code, note: r.note || '' })} aria-label={zh ? '編輯' : 'Edit'} style={{ fontSize: 12 }}>✎</button>}</span>)}</div></td>
                <td><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn mini" onClick={() => setEdit({ table: 'racks', locker_id: l.id, code: '' })}>{zh ? '＋ 架子' : '+ Rack'}</button>
                  <button className="btn mini" onClick={() => setEdit({ table: 'lockers', id: l.id, code: l.code, note: l.note || '' })}>{zh ? '編輯' : 'Edit'}</button>
                  {l.racks.every((r) => !r.n && !r.cases) && <button className="btn mini" onClick={() => del('lockers', l.id, l.code)}>{zh ? '刪除' : 'Delete'}</button>}</div></td></tr>))}</tbody>
          </table></div>
        </div>))}
      <div className="muted small">{zh ? '黃色的「未指定」架子是匯入時建立的預設架子。' : 'Yellow “未指定” racks were created by the import.'} <Link to="/labels">{zh ? '列印分儲空間／架子標籤 ›' : 'Print locker / rack labels ›'}</Link></div>
      {edit && (
        <Modal title={{ cellars: zh ? '酒窖' : 'Cellar', lockers: zh ? '分儲空間' : 'Locker', racks: zh ? '架子' : 'Rack' }[edit.table]} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" disabled={!(edit.name || edit.code)} onClick={save}>{zh ? '儲存' : 'Save'}</button></>}>
          {edit.table === 'cellars' ? <>
            <label className="f">{zh ? '名稱 *' : 'Name *'}<input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="f">{zh ? '地址' : 'Address'}<input className="input" value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
          </> : <label className="f">{zh ? '代碼 / 名稱 *' : 'Code / name *'}<input className="input" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder={edit.table === 'lockers' ? 'A31' : zh ? '上層' : 'Top'} /></label>}
          <label className="f">{zh ? '備註' : 'Note'}<input className="input" value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
        </Modal>
      )}
    </Section>
  );
}

function Bookmarklet({ zh }) {
  const ref = useRef();
  useEffect(() => { ref.current?.setAttribute('href', bookmarkletCode(location.origin)); }, []);
  return <a ref={ref} className="btn primary" style={{ alignSelf: 'flex-start', cursor: 'grab' }} onClick={(e) => { e.preventDefault(); toast(zh ? '請用拖的，把按鈕拖到書籤列' : 'Drag it to the bookmarks bar'); }}>{zh ? '查價助手' : 'Price helper'}</a>;
}

function PriceSettings({ zh }) {
  const { data } = useApi('/api/settings');
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF(data.price); }, [data]);
  if (!f) return null;
  const fld = (k, l, p) => <label className="f">{l}<input className="input" value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...p} /></label>;
  const sample = (f.url_template || '').replace('{name}', encodeURIComponent('Krug Grande Cuvee')).replace('{winery}', 'Krug').replace('{vintage}', 'NV').replace('{volume}', '750');
  return (
    <Section title={zh ? '查價設定' : 'Price lookup'} sub={zh ? '查價助手在你自己的瀏覽器開啟查價頁；系統不儲存 Wine-Searcher 帳號密碼。' : 'The price helper opens pages in your own browser; no Wine-Searcher password is stored. '} zh={zh}>
      <div className="grid g2" style={{ gap: 12 }}>
        {fld('site', zh ? '查價網站' : 'Site')}{fld('currency', zh ? '價格幣別' : 'Currency')}
      </div>
      {fld('url_template', zh ? '查價網址範本' : 'URL template')}
      <div className="muted small">{zh ? '可用變數' : 'Variables'} {'{name} {winery} {vintage} {volume}'} · {zh ? '範例：' : 'Example: '}<a href={sample} target="_blank" rel="noreferrer noopener" style={{ wordBreak: 'break-all' }}>{sample}</a></div>
      <div className="grid g3" style={{ gap: 12 }}>
        {fld('stale_days', zh ? '超過幾天未查價就列入佇列' : 'Queue after (days)', { inputMode: 'numeric' })}{fld('per_hour', zh ? '每小時建議數量' : 'Per hour', { inputMode: 'numeric' })}{fld('per_day', zh ? '每天建議數量' : 'Per day', { inputMode: 'numeric' })}
      </div>
      <div className="grid g2" style={{ gap: 12 }}>
        {fld('min_wait', zh ? '每款之間最少等幾秒' : 'Min wait (s)', { inputMode: 'numeric' })}{fld('max_wait', zh ? '每款之間最多等幾秒' : 'Max wait (s)', { inputMode: 'numeric' })}
      </div>
      {fld('order_markup', zh ? '訂單預設單價用市場價格時加成 %（0 = 照市場價格）' : 'Order default price: markup on market price % (0 = as is)', { inputMode: 'decimal' })}
      <div className="muted small">{zh ? '訂單單價預設順序：客戶上次成交價 → 建議售價 → 市場價格（加上這裡的加成）。' : 'Order price defaults: customer’s last price → suggested price → market price (+ markup).'}</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => run(() => api('/api/settings/price', { method: 'PUT', body: f }), zh ? '已儲存查價設定' : 'Saved')}>{zh ? '儲存查價設定' : 'Save'}</button></div>
      <div className="rackbox" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <b>{zh ? '查價助手書籤' : 'Price helper bookmark'}</b>
        <div className="small">{zh ? '把下面的按鈕拖到瀏覽器的書籤列（Chrome / Safari / Edge 桌機）。在 Wine-Searcher 看到價格時按它，會讀取這一頁的價格與網址、讓你確認後送回查價助手。它不會讀取其他頁面，也不會儲存帳號密碼。' : 'Drag this button to your bookmarks bar. On a Wine-Searcher page, click it to send the price back to the helper.'}</div>
        <Bookmarklet zh={zh} />
        <div className="muted small">{zh ? '書籤列沒出現：Chrome 按 Ctrl/⌘ + Shift + B；Safari 選「顯示方式 › 顯示書籤列」。' : 'Show the bookmarks bar with Ctrl/⌘+Shift+B.'}</div>
      </div>
    </Section>
  );
}

const CNT = { wines: ['酒款', 'wines'], bottles: ['酒瓶', 'bottles'], cases: ['酒箱', 'cases'], orders: ['訂單', 'orders'], lists: ['清單', 'lists'], reserved: ['保留中酒瓶', 'reserved bottles'],
  users: ['其他使用者', 'other users'], customers: ['客戶', 'customers'], cellars: ['酒窖', 'cellars'], lockers: ['分儲空間', 'lockers'], racks: ['架子', 'racks'], logs: ['筆紀錄', 'entries'] };
const SCOPE_EN = { inventory: 'Inventory', orders: 'Orders', users: 'Users', customers: 'Customers', cellars: 'Cellars', logs: 'Change log' };

function ClearData({ zh }) {
  const [v, setV] = useState(0);
  const { data } = useApi('/api/admin/clear?v=' + v);
  const [dlg, setDlg] = useState(null);
  const [done, setDone] = useState(null);
  const go = async () => {
    const r = await run(() => api('/api/admin/clear', { method: 'POST', body: { scope: dlg.k, phrase: dlg.phrase, password: dlg.password } }), zh ? '已清除' : 'Cleared');
    setDone(r); setDlg(null); setV(v + 1);
  };
  return (
    <Section title={zh ? '清除資料' : 'Clear data'} sub={zh ? '把整類資料清空，例如測試完要正式上線時。每次清除前都會自動備份整個資料庫。' : 'Empty a whole category, e.g. after testing. The full database is backed up first, every time.'}>
      <div className="flash warn">{zh ? '⚠ 清除後畫面上就看不到這些資料。需要兩道確認：輸入確認文字＋你自己的 6 位數密碼。' : '⚠ Two checks are required: type the confirmation phrase and your own 6-digit password.'}</div>
      {done && <div className="flash ok">{zh ? `已清除「${done.scope && data?.[done.scope]?.label}」。備份檔：data/backup/${done.backup}（要還原請找系統管理員）` : `Cleared. Backup: data/backup/${done.backup}`}</div>}
      <div className="tbl-wrap"><table className="tbl stack">
        <thead><tr><th>{zh ? '項目' : 'Item'}</th><th>{zh ? '會刪除' : 'Deletes'}</th><th>{zh ? '目前數量' : 'Current'}</th><th></th></tr></thead>
        <tbody>{data && Object.entries(data).map(([k, s]) => {
          const empty = Object.entries(s.counts).filter(([c]) => !(k === 'customers' && c === 'orders') && !(k === 'cellars' && c === 'bottles')).every(([, x]) => !x);
          return (
            <tr key={k}>
              <td style={{ whiteSpace: 'nowrap' }}><b>{zh ? s.label : SCOPE_EN[k]}</b></td>
              <td className="small">{s.desc}{s.blocked && <div className="tag warn" style={{ marginTop: 4 }}>{s.blocked}</div>}</td>
              <td className="small">{Object.entries(s.counts).filter(([c]) => !(k === 'customers' && c === 'orders') && !(k === 'cellars' && c === 'bottles')).map(([c, x]) => <div key={c}>{num(x)} {zh ? CNT[c]?.[0] : CNT[c]?.[1]}</div>)}</td>
              <td><button className="btn mini" style={{ color: 'var(--err)', borderColor: 'var(--err)' }} disabled={!!s.blocked || empty} onClick={() => setDlg({ k, s, phrase: '', password: '' })}>{zh ? '清除…' : 'Clear…'}</button></td>
            </tr>);
        })}</tbody></table></div>
      {dlg && (
        <Modal title={(zh ? '清除' : 'Clear ') + (zh ? dlg.s.label : SCOPE_EN[dlg.k])} onClose={() => setDlg(null)}
          footer={<><button className="btn" onClick={() => setDlg(null)}>{zh ? '取消' : 'Cancel'}</button>
            <button className="btn" style={{ background: 'var(--err)', borderColor: 'var(--err)', color: '#fff' }} disabled={dlg.phrase.trim() !== dlg.s.phrase || !/^\d{6}$/.test(dlg.password)} onClick={go}>{zh ? '永久清除' : 'Clear permanently'}</button></>}>
          <div className="flash err">{dlg.s.desc}</div>
          <label className="f"><span>{zh ? <>第一道確認：請輸入「<b>{dlg.s.phrase}</b>」</> : <>Step 1: type <b>{dlg.s.phrase}</b></>}</span>
            <input className="input" autoComplete="off" value={dlg.phrase} onChange={(e) => setDlg({ ...dlg, phrase: e.target.value })} /></label>
          <label className="f">{zh ? '第二道確認：你自己的 6 位數密碼' : 'Step 2: your own 6-digit password'}
            <input className="input" type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" value={dlg.password} onChange={(e) => setDlg({ ...dlg, password: e.target.value.replace(/\D/g, '') })} /></label>
          <div className="muted small">{zh ? '按下後會先備份整個資料庫到 data/backup，再刪除。' : 'The whole database is backed up to data/backup before deleting.'}</div>
        </Modal>
      )}
    </Section>
  );
}

const TABS = [['company', '公司資料', 'Company', Company], ['users', '使用者', 'Users', Users], ['customers', '客戶', 'Customers', Customers], ['merchants', '酒商', 'Merchants', Merchants],
  ['types', '代碼表（術語）', 'Code tables', Types], ['storage', '儲位管理', 'Storage', Storage], ['price', '查價設定', 'Price lookup', PriceSettings], ['clear', '清除資料', 'Clear data', ClearData]];

export default function Settings() {
  const { tab = 'company' } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const cur = TABS.find((x) => x[0] === tab) || TABS[0];
  const C = cur[3];
  useEffect(() => { if (!TABS.some((x) => x[0] === tab)) toast(zh ? '找不到這個設定頁' : 'Unknown tab', 'err'); }, [tab, zh]);
  return (
    <div className="page">
      <div className="row between"><h1>{zh ? '設定' : 'Settings'}</h1><span className="muted small">{zh ? '每一項都可下載範本、上傳或匯出 Excel' : 'Every item supports Excel template, upload and export'}</span></div>
      <nav className="tabs" aria-label={zh ? '設定項目' : 'Settings'}>{TABS.map(([k, a, b]) => <Link key={k} to={'/settings/' + k} className={k === cur[0] ? 'on' : ''}>{zh ? a : b}</Link>)}</nav>
      <C zh={zh} />
    </div>
  );
}
