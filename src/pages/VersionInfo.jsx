import { CLIENT_VERSION, BUILD_TIME, useServerVersion, hardReload, fmtTime } from '../version.js';

export default function VersionInfo({ zh }) {
  const sv = useServerVersion();
  const stale = sv && sv.version !== CLIENT_VERSION;
  return (
    <div className="card">
      <h2 style={{ margin: 0 }}>{zh ? '系統版本' : 'Version'}</h2>
      <div className="grid g2" style={{ gap: 8, marginTop: 10 }}>
        <div><span className="muted small">{zh ? '版本' : 'Version'}</span><div style={{ fontSize: 20, fontWeight: 700 }}>v{sv?.version || CLIENT_VERSION}</div></div>
        <div className="small"><div><span className="muted">{zh ? '畫面版本：' : 'Screens: '}</span>v{CLIENT_VERSION}（{zh ? '建置於 ' : 'built '}{fmtTime(BUILD_TIME)}）</div>
          <div><span className="muted">{zh ? '伺服器版本：' : 'Server: '}</span>{sv ? `v${sv.version}（${zh ? '啟動於 ' : 'started '}${fmtTime(sv.started)}）` : '—'}</div></div>
      </div>
      {stale && <div className="flash warn" style={{ marginTop: 10 }}>{zh ? `畫面是 v${CLIENT_VERSION}，伺服器是 v${sv.version}。請先按「重新載入」；還是一樣的話，在伺服器電腦執行 npm run build 再重新啟動。` : `Screens v${CLIENT_VERSION} differ from server v${sv.version}. Reload; if it persists, run npm run build and restart the server.`}
        <div style={{ marginTop: 6 }}><button className="btn mini" onClick={hardReload}>{zh ? '重新載入' : 'Reload'}</button></div></div>}
    </div>
  );
}
