import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useContext, useEffect, useState } from 'react';
import { api, num } from './api.js';
import { LangCtx, useT } from './i18n.jsx';
import Icon from './icons.jsx';
import { useCompany, companyName } from './company.js';
import { useOffline, pendingCount } from './offline/store.js';
import { SyncPill } from './m/common.jsx';

export default function Layout({ user, onLogout }) {
  const t = useT();
  const { lang, setLang } = useContext(LangCtx);
  const nav = useNavigate();
  const company = useCompany();
  const [stock, setStock] = useState(null);
  const loc = useLocation();
  useEffect(() => { api('/api/dashboard').then(setStock).catch(() => {}); }, [loc.pathname]);
  const zh = lang !== 'en';
  const items = [
    ['/', 'dash', zh ? '總覽' : 'Overview', true],
    ['/search', 'search', zh ? '庫存搜尋' : 'Search'],
    ['/storage', 'storage', zh ? '儲位' : 'Storage'],
    ['/lists', 'lists', zh ? '我的清單' : 'My lists'],
    ['/orders', 'order', zh ? '訂單' : 'Orders'],
    ['/prices', 'price', zh ? '市場價格' : 'Market prices'],
    ['/import', 'import', zh ? '匯入' : 'Import'],
    ['/labels', 'labels', zh ? '標籤列印' : 'Labels'],
    ['/stocktakes', 'count', zh ? '盤點紀錄' : 'Stock counts'],
    ['/audit', 'log', t('audit')],
    ['/settings', 'settings', t('settings')],
  ];
  const off = useOffline();
  const logout = async () => {
    const n = pendingCount();
    if (n && !confirm(zh ? `手機上還有 ${n} 筆沒同步，登出會清除手機資料、這些操作會遺失。確定登出？` : `${n} changes are not synced and will be lost. Log out?`)) return;
    await api('/api/logout', { method: 'POST' }).catch(() => {}); onLogout(); nav('/');
  };
  const offline = user.offline || (!off.online && off.snap);
  return (
    <div className="shell">
      <nav className="nav" aria-label={zh ? '主選單' : 'Main menu'}>
        <div className="brand">{company?.logo ? <img src={"/api/public/logo?f=" + company.logo} alt="" style={{ width: 28, height: 28, objectFit: 'contain', background: '#fff', borderRadius: 6 }} /> : <Icon n="glass" s={28} c="#D9A3B6" />}<div><b>{zh ? '酒窖庫存' : 'Cellar Stock'}</b><small>{companyName(company, zh)}</small></div></div>
        {items.map(([to, ic, label, end, soon]) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '') + (soon ? ' soon' : '')}>
            <Icon n={ic} />{label}
          </NavLink>
        ))}
        <div className="foot">{stock ? (zh ? `庫存 ${num(stock.bottles)} 瓶 · ${num(stock.cases)} 箱` : `${num(stock.bottles)} bottles · ${num(stock.cases)} cases`) : ' '}</div>
      </nav>
      <div className="main">
        <header className="top">
          <span className="mobile-only row" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}><Icon n="glass" s={22} c="#7B2342" />{zh ? '酒窖庫存' : 'Cellar Stock'}</span>
          <span className="sp" />
          {off.snap && !loc.pathname.startsWith('/m') && <span className="mobile-only"><SyncPill zh={zh} /></span>}
          <div className="seg desk" role="group" aria-label="語言 Language">
            <button className={zh ? 'on' : ''} onClick={() => setLang('zh')}>中文</button>
            <button className={!zh ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
          <span className="muted desk">{user.name || user.login}</span>
          <button className="btn ghost" onClick={logout} title={t('logout')}><Icon n="out" /><span className="desk">{t('logout')}</span></button>
        </header>
        {offline && !loc.pathname.startsWith('/m') && <div className="offline-banner">{zh ? '離線中：可以用「掃描」與「搜尋」查詢、移動與盤點；其他功能回到公司 Wi-Fi 再使用。' : 'Offline: scan and search still work; other features need the office Wi-Fi.'} <a href="/m">{zh ? '前往掃描 ›' : 'Go to scan ›'}</a></div>}
        <Outlet context={{ items }} />
      </div>
      <nav className="mbar" aria-label={zh ? '主選單' : 'Main menu'}>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><Icon n="dash" s={22} />{zh ? '總覽' : 'Home'}</NavLink>
        <NavLink to={offline ? '/m/search' : '/search'} className={({ isActive }) => (isActive || loc.pathname.startsWith('/m/search') ? 'active' : '')}><Icon n="search" s={22} />{zh ? '搜尋' : 'Search'}</NavLink>
        <NavLink to="/m" end className={() => (loc.pathname.startsWith('/m') && !loc.pathname.startsWith('/m/search') ? 'active' : '')}><Icon n="scan" s={22} />{zh ? '掃描' : 'Scan'}</NavLink>
        <NavLink to="/lists" className={({ isActive }) => (isActive ? 'active' : '')}><Icon n="lists" s={22} />{zh ? '清單' : 'Lists'}</NavLink>
        <NavLink to="/more" className={({ isActive }) => (isActive || ['/import', '/labels', '/audit', '/settings', '/move', '/prices', '/stocktakes', '/storage', '/orders', '/customers'].some((p) => loc.pathname.startsWith(p)) ? 'active' : '')}><Icon n="more" s={22} />{zh ? '更多' : 'More'}</NavLink>
      </nav>
    </div>
  );
}
