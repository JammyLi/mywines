import { useParams } from 'react-router-dom';
import { useT } from '../i18n.jsx';

const NAMES = { lists: ['我的清單', 'My lists'], price: ['市場價格更新', 'Market price update'], labels: ['標籤列印', 'Labels'], settings: ['設定', 'Settings'] };
export default function Soon() {
  const { what } = useParams();
  const t = useT();
  const n = NAMES[what] || [what, what];
  return <div className="page"><h1>{n[t.lang === 'en' ? 1 : 0]}</h1><div className="card">{t('phase2')}</div></div>;
}
