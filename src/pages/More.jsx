import { useContext } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { LangCtx } from '../i18n.jsx';
import Icon from '../icons.jsx';
import { useT } from '../i18n.jsx';

export default function More() {
  const { items } = useOutletContext();
  const t = useT();
  const zh = t.lang !== 'en';
  const { setLang } = useContext(LangCtx);
  return (
    <div className="page">
      <h1>{zh ? '更多' : 'More'}</h1>
      <div className="card tree" style={{ padding: 8 }}>
        {[items[2], ...items.slice(4), ['/m/sync', 'scan', zh ? '同步狀態' : 'Sync status'], ['/move', 'storage', zh ? '移動 / 調撥' : 'Move'], ['/wines/new', 'import', zh ? '新增酒款' : 'New wine']].map(([to, ic, label, , soon]) => (
          <Link key={to} to={to} style={{ justifyContent: 'flex-start', gap: 12, opacity: soon ? 0.5 : 1 }}><Icon n={ic} />{label}</Link>
        ))}
      </div>
      <div className="card row between"><span>{zh ? '介面語言' : 'Language'}</span>
        <div className="seg"><button className={zh ? 'on' : ''} onClick={() => setLang('zh')}>中文</button><button className={!zh ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div></div>
      <a className="card" href={`http://${location.hostname}:${location.port === '3443' ? '3000' : location.port || '3000'}/setup`}>{zh ? '手機設定（安裝憑證、加入主畫面）›' : 'Phone setup ›'}</a>
    </div>
  );
}
