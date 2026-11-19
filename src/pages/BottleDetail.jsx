import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { handoff } from '../handoff.js';
import { StatusModal, StockoutModal } from './dialogs.jsx';
import { useApi } from '../hooks.js';
import { ntd } from '../api.js';
import { useT } from '../i18n.jsx';
import { Loading } from './parts.jsx';

export default function BottleDetail() {
  const { no } = useParams();
  const t = useT();
  const zh = t.lang !== 'en';
  const nav = useNavigate();
  const [v, setV] = useState(0);
  const [dlg, setDlg] = useState(false);
  const st = useApi('/api/bottles/' + encodeURIComponent(no) + '?v=' + v);
  if (!st.data) return <Loading state={st} />;
  const b = st.data;
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="crumbs"><Link to={'/wines/' + b.wine_no}>{b.wine_no}</Link>›<span>{b.bottle_no}</span></div>
      <div className="row between"><h1>{b.bottle_no}</h1>
        <div className="row">
          <button className="btn" onClick={() => nav('/labels?k=' + handoff({ kind: 'bottle', bottle_nos: [b.bottle_no] }))}>{zh ? '列印瓶標' : 'Print label'}</button>
          {b.status === 'in_stock' && <button className="btn" onClick={() => setDlg('out')}>{zh ? '出庫' : 'Remove'}</button>}
          <button className="btn" onClick={() => setDlg(true)}>{zh ? '變更狀態' : 'Status'}</button>
          {b.status === 'in_stock' && <button className="btn primary" onClick={() => nav('/move?k=' + handoff({ what: 'bottles', bottle_nos: [b.bottle_no] }))}>{zh ? '移動' : 'Move'}</button>}
        </div></div>
      {dlg === 'out' && <StockoutModal bottle_nos={[b.bottle_no]} zh={zh} onClose={(n) => { setDlg(false); if (n) setV(v + 1); }} />}
      {dlg === true && <StatusModal bottle_nos={[b.bottle_no]} zh={zh} onClose={(n) => { setDlg(false); if (n) setV(v + 1); }} />}
      <div className="card">
        <dl className="dl">
          <dt>{t('name')}</dt><dd><Link to={'/wines/' + b.wine_no}>{b.name}</Link></dd>
          <dt>{t('vintage')}</dt><dd>{b.vintage}</dd>
          <dt>{t('type')}</dt><dd>{b.type_zh}</dd>
          <dt>{t('volume')}</dt><dd>{b.volume_ml ? b.volume_ml + ' ml' : '—'}</dd>
          <dt>{t('location')}</dt><dd>{b.cellar} › {b.locker} › {b.rack}</dd>
          <dt>{t('caseNo')}</dt><dd>{b.case_no ? <Link to={'/cases/' + encodeURIComponent(b.case_no)}>{b.case_no}</Link> : t('loose')}</dd>
          <dt>{t('status')}</dt><dd>{t(b.status)}{b.out_reason ? `（${b.out_reason}）` : ''}</dd>
          <dt>{t('merchant')}</dt><dd>{b.merchant || '—'}</dd>
          <dt>{t('cost')}</dt><dd>{ntd(b.cost)}</dd>
          <dt>{t('market')}</dt><dd>{ntd(b.price)} <span className="muted small">{b.price_date}</span></dd>
          <dt>{zh ? '標籤' : 'Label'}</dt><dd>{b.label_printed_at || (zh ? '尚未列印' : 'Not printed')}</dd>
        </dl>
      </div>
    </div>
  );
}
