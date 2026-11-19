import QRCode from 'qrcode';
import { lanAddresses } from './tls.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function setupPage(req, opts) {
  const host = (req.headers.host || '').split(':')[0];
  const ip = /^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== '127.0.0.1' ? host : lanAddresses()[0] || host;
  const httpsUrl = `https://${ip}:${opts.httpsPort || 3443}/m`;
  const caUrl = `http://${ip}:${opts.httpPort || 3000}/ca.crt`;
  const qr = await QRCode.toString(httpsUrl, { type: 'svg', margin: 1 });
  const qrSetup = await QRCode.toString(`http://${ip}:${opts.httpPort || 3000}/setup`, { type: 'svg', margin: 1 });
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>手機設定 · 酒類庫存管理系統</title>
<style>
body{margin:0;font-family:Inter,'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif;background:#F6F5F3;color:#1F1A1C;line-height:1.6}
main{max-width:720px;margin:0 auto;padding:24px 18px 60px}h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:0 0 8px}
.card{background:#fff;border:1px solid #E4E1DC;border-radius:12px;padding:18px 20px;margin-top:16px}
.btn{display:inline-block;background:#7B2342;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;margin:6px 0}
.muted{color:#6B6466;font-size:14px}ol{padding-left:22px;margin:6px 0}li{margin:4px 0}.qr{width:180px;height:180px}.row{display:flex;gap:20px;flex-wrap:wrap;align-items:center}
code{background:#F4E9ED;color:#7B2342;padding:2px 6px;border-radius:4px;word-break:break-all}
</style></head><body><main>
<h1>手機設定</h1>
<div class="muted">每支手機只要做一次。做完後，手機可以用相機掃描 QR Code，在酒窖沒有訊號時也能操作，回到公司 Wi-Fi 會自動同步。</div>
<div class="card row"><div class="qr">${qrSetup}</div><div><b>用手機開這一頁</b><div class="muted">用手機相機掃左邊的 QR Code（手機要連公司 Wi-Fi）。</div></div></div>
<div class="card"><h2>1. 下載本機憑證</h2>
<div class="muted">這是這台電腦自己產生的憑證，只在公司內網使用，讓手機信任這個系統的加密連線。</div>
<a class="btn" href="${esc(caUrl)}">下載憑證</a></div>
<div class="card"><h2>2a. iPhone 安裝與信任</h2><ol>
<li>用 <b>Safari</b> 按上面的「下載憑證」，出現提示時選「允許」。</li>
<li>打開「設定」，最上方會出現「已下載描述檔」，點進去按「安裝」，輸入手機密碼。</li>
<li>到「設定 › 一般 › 關於本機 › 憑證信任設定」，把「MyWines Local CA」<b>打開</b>。</li></ol></div>
<div class="card"><h2>2b. Android 安裝</h2><ol>
<li>用 <b>Chrome</b> 按「下載憑證」。</li>
<li>打開「設定」，搜尋「憑證」，選「安裝憑證 › CA 憑證」（不同手機名稱略有不同），選剛下載的 mywines-ca.crt。</li>
<li>出現警告時選「仍要安裝」。</li></ol></div>
<div class="card row"><div class="qr">${qr}</div><div><h2>3. 開啟手機版</h2>
<a class="btn" href="${esc(httpsUrl)}">開啟 ${esc(httpsUrl)}</a>
<div class="muted">登入後，按瀏覽器的「分享 › 加入主畫面」（iPhone）或「⋮ › 安裝應用程式」（Android），之後從主畫面圖示開啟。</div></div></div>
<div class="card"><h2>常見問題</h2><ol>
<li>出現「連線不是私人連線」：憑證還沒安裝或 iPhone 還沒在「憑證信任設定」打開。</li>
<li>電腦的內網 IP 變了：系統會自動換新的網址憑證，手機不用重新安裝；只要用新的網址開啟。建議請網管把這台電腦設成固定 IP。</li>
<li>資料都存在公司這台電腦；手機上只放查詢用的副本（不含採購價格、客戶與設定），登出時清除。</li></ol></div>
</main></body></html>`;
}
