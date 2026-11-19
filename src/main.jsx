import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api.js';
import { LangCtx } from './i18n.jsx';
import Layout from './Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Search from './pages/Search.jsx';
import WineDetail from './pages/WineDetail.jsx';
import CaseDetail from './pages/CaseDetail.jsx';
import BottleDetail from './pages/BottleDetail.jsx';
import Storage from './pages/Storage.jsx';
import Import from './pages/Import.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Soon from './pages/Soon.jsx';
import WineEdit from './pages/WineEdit.jsx';
import Move from './pages/Move.jsx';
import Lists from './pages/Lists.jsx';
import Labels from './pages/Labels.jsx';
import PrintLabels from './pages/PrintLabels.jsx';
import Export from './pages/Export.jsx';
import PrintExport from './pages/PrintExport.jsx';
import Settings from './pages/Settings.jsx';
import { Toasts } from './ui.jsx';
import More from './pages/More.jsx';
import Stocktakes from './pages/Stocktakes.jsx';
import Orders from './pages/Orders.jsx';
import OrderEdit from './pages/OrderEdit.jsx';
import OrderShip from './pages/OrderShip.jsx';
import PrintOrder from './pages/PrintOrder.jsx';
import CustomerDetail from './pages/CustomerDetail.jsx';
import Stockout from './pages/Stockout.jsx';
import { PriceUpdate, PriceHelper, PriceReturn } from './pages/Prices.jsx';
import { MHome, MBottle, MCase, MLocker, MWine, MMove, MScanList, MCount, MSearch, MSync, MConflicts } from './m/MobilePages.jsx';
import { startOffline, clearLocal } from './offline/store.js';
import './styles.css';

// 手機：表格改成卡片，欄位名稱放在每格前面
const label = () => document.querySelectorAll('table.stack').forEach((tb) => {
  const heads = [...tb.querySelectorAll('thead th')].map((th) => th.textContent);
  tb.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (heads[i] && td.dataset.l !== heads[i]) td.dataset.l = heads[i]; }));
});
new MutationObserver(label).observe(document.getElementById('root'), { childList: true, subtree: true });

function App() {
  const [user, setUser] = useState(undefined);
  const [lang, setLangState] = useState(localStorage.getItem('lang') || 'zh');
  const setLang = (l) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); } catch {}
    if (user) api('/api/me/lang', { method: 'PUT', body: { lang: l } }).catch(() => {});
  };
  useEffect(() => {
    api('/api/me').then((u) => { localStorage.setItem('me', JSON.stringify(u)); localStorage.setItem('meLogin', u.login); setUser(u); })
      .catch((e) => {
        // 連不到伺服器（例如在酒窖沒有訊號）：用上次登入的身分進入手機離線功能
        const cached = localStorage.getItem('me');
        if (!e.status && cached) setUser({ ...JSON.parse(cached), offline: true }); else setUser(null);
      });
    const off = () => setUser(null);
    window.addEventListener('mywines:logout', off);
    return () => window.removeEventListener('mywines:logout', off);
  }, []);
  useEffect(() => {
    if (user && (window.matchMedia('(max-width: 900px)').matches || location.pathname.startsWith('/m'))) startOffline();
  }, [user]);
  useEffect(() => { document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'; }, [lang]);
  if (user === undefined) return null;
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      {!user ? (
        <Routes>
          <Route path="price/return" element={<PriceReturn />} />
          <Route path="*" element={<Login onLogin={(u) => { localStorage.setItem('me', JSON.stringify(u)); localStorage.setItem('meLogin', u.login); setUser(u); if (u.lang) setLangState(u.lang); }} />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="print/labels" element={<PrintLabels />} />
          <Route path="print/export" element={<PrintExport />} />
          <Route path="print/order/:no" element={<PrintOrder />} />
          <Route path="price/return" element={<PriceReturn />} />
          <Route element={<Layout user={user} onLogout={async () => { await clearLocal().catch(() => {}); localStorage.removeItem('me'); localStorage.removeItem('meLogin'); setUser(null); }} />}>
            <Route index element={<Dashboard />} />
            <Route path="search" element={<Search />} />
            <Route path="wines/new" element={<WineEdit mode="new" />} />
            <Route path="wines/:no" element={<WineDetail />} />
            <Route path="wines/:no/edit" element={<WineEdit mode="edit" />} />
            <Route path="wines/:no/stock" element={<WineEdit mode="stock" />} />
            <Route path="move" element={<Move />} />
            <Route path="lists" element={<Lists />} />
            <Route path="lists/:id" element={<Lists />} />
            <Route path="labels" element={<Labels />} />
            <Route path="export" element={<Export />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/:tab" element={<Settings />} />
            <Route path="cases/:no" element={<CaseDetail />} />
            <Route path="bottles/:no" element={<BottleDetail />} />
            <Route path="storage" element={<Storage />} />
            <Route path="storage/:lockerId" element={<Storage />} />
            <Route path="import" element={<Import />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="soon/:what" element={<Soon />} />
            <Route path="more" element={<More />} />
            <Route path="prices" element={<PriceUpdate />} />
            <Route path="prices/helper" element={<PriceHelper />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:no" element={<OrderEdit />} />
            <Route path="orders/:no/ship" element={<OrderShip />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="stockout" element={<Stockout />} />
            <Route path="stocktakes" element={<Stocktakes />} />
            <Route path="stocktakes/:id" element={<Stocktakes />} />
            <Route path="m" element={<MHome />} />
            <Route path="m/b/:no" element={<MBottle />} />
            <Route path="m/c/:no" element={<MCase />} />
            <Route path="m/l/:id" element={<MLocker />} />
            <Route path="m/w/:no" element={<MWine />} />
            <Route path="m/move" element={<MMove />} />
            <Route path="m/list" element={<MScanList />} />
            <Route path="m/count" element={<MCount />} />
            <Route path="m/search" element={<MSearch />} />
            <Route path="m/sync" element={<MSync />} />
            <Route path="m/conflicts" element={<MConflicts />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
      <Toasts />
    </LangCtx.Provider>
  );
}

// 離線用：只在安全連線（HTTPS 或 localhost）註冊 Service Worker
if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
