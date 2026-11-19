// 連線位址：其他電腦與手機要輸入的網址
import { useApi } from '../hooks.js';
import { toast } from '../ui.jsx';

const copy = async (s, zh) => {
  try { await navigator.clipboard.writeText(s); toast(zh ? '已複製' : 'Copied'); }
  catch { window.prompt(zh ? '請複製這個網址' : 'Copy this address', s); }
};

export default function ServerInfo({ zh, compact }) {
  const { data } = useApi('/api/server-info');
  if (!data) return null;
  const list = data.urls || [];
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>{zh ? '連線位址' : 'Server address'}</h2>
        <a href="/setup" target="_blank" rel="noreferrer" className="btn mini">{zh ? '手機設定頁（QR Code）' : 'Phone setup (QR code)'}</a></div>
      <div className="muted small" style={{ margin: '4px 0 10px' }}>{zh ? '其他電腦與手機（連同一個網路）請輸入下面的網址。在伺服器這台電腦也可以用 http://localhost:' + data.httpPort : 'Other computers and phones on the same network use the address below. On the server itself, http://localhost:' + data.httpPort + ' also works.'}</div>
      {!list.length && <div className="flash warn">{zh ? '找不到網路位址：這台電腦沒有連上網路。' : 'No network address: this computer is not on a network.'}</div>}
      {list.map((u) => (
        <div key={u.ip} className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span className="tag">{zh ? '電腦' : 'Computer'}</span><code style={{ fontSize: 15 }}>{u.pc}</code>
          <button className="btn mini" onClick={() => copy(u.pc, zh)}>{zh ? '複製' : 'Copy'}</button>
          {!compact && u.phone && <><span className="tag">{zh ? '手機' : 'Phone'}</span><code>{u.phone}</code></>}
        </div>))}
      {list.length > 1 && <div className="muted small">{zh ? '有好幾個位址時，用和手機同一個 Wi-Fi 的那一個（通常是 192.168 開頭）。' : 'If there are several, use the one on the same Wi-Fi as the phones (usually 192.168…).'}</div>}
      {!compact && <div className="muted small" style={{ marginTop: 6 }}>{zh ? '建議請管理路由器的人為這台電腦設定「固定 IP（DHCP 保留）」，位址就不會變，書籤和手機主畫面圖示會一直有效。' : 'Ask whoever manages the router for a DHCP reservation (fixed IP) for this computer so the address never changes.'}</div>}
    </div>
  );
}
