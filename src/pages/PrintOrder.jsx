import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ntd } from '../api.js';
import { QR } from '../ui.jsx';

const L = {
  zh: { title: '訂購單', no: '訂單編號', date: '訂單日期', delivery: '預計交貨日', to: '客戶', addr: '送貨地址', wine: '品名', vintage: '年份', qty: '數量', price: '單價', disc: '折扣', amount: '小計', subtotal: '小計', tax: '營業稅', ship: '運費', total: '總金額（含稅）', note: '備註', tel: '電話', taxid: '統一編號', thanks: '感謝您的訂購。', pick: '揀貨單', loc: '位置', bottles: '瓶號', done: '揀貨人簽名', btl: '瓶' },
  en: { title: 'Order', no: 'Order no.', date: 'Date', delivery: 'Delivery', to: 'Customer', addr: 'Deliver to', wine: 'Wine', vintage: 'Vintage', qty: 'Qty', price: 'Unit price', disc: 'Disc.', amount: 'Amount', subtotal: 'Subtotal', tax: 'VAT', ship: 'Shipping', total: 'Total (incl. VAT)', note: 'Note', tel: 'Tel', taxid: 'Tax ID', thanks: 'Thank you for your order.', pick: 'Picking list', loc: 'Location', bottles: 'Bottles', done: 'Picked by', btl: 'btl' },
};

export default function PrintOrder() {
  const { no } = useParams();
  const [sp] = useSearchParams();
  const kind = sp.get('kind') === 'pick' ? 'pick' : 'customer';
  const [d, setD] = useState(null);
  useEffect(() => { api('/api/orders/' + no).then((x) => { setD(x); setTimeout(() => window.print(), 700); }); }, [no]);
  if (!d) return <div className="page muted">…</div>;
  const o = d.order, co = d.company, c = d.customer;
  const lang = kind === 'pick' ? 'zh' : o.lang === 'en' ? 'en' : 'zh';
  const s = L[lang];
  return (
    <div className="doc">
      <style>{`@page { size: A4; margin: 14mm 12mm; }
        .doc { max-width: 190mm; margin: 0 auto; padding: 16px; background: #fff; color: #111; font-size: 10pt; }
        .doc .hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #7B2342; padding-bottom: 8px; margin-bottom: 14px; gap: 12px; }
        .doc table { width: 100%; border-collapse: collapse; } .doc th { text-align: left; font-size: 8.5pt; color: #555; border-bottom: 1px solid #999; padding: 6px; }
        .doc td { border-bottom: 1px solid #ddd; padding: 6px; vertical-align: top; break-inside: avoid; } .doc .r { text-align: right; white-space: nowrap; } .doc .sub { color: #666; font-size: 8.5pt; }
        .doc .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 14px; } .doc .tot { margin-left: auto; width: 260px; margin-top: 10px; display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; }
        .doc .box { display: inline-block; width: 12px; height: 12px; border: 1px solid #333; margin-right: 6px; vertical-align: -2px; }
        @media print { .no-print { display: none !important; } .doc { padding: 0; } }`}</style>
      <div className="no-print row between card" style={{ marginBottom: 16 }}>
        <span>在列印視窗選「另存為 PDF」即可存檔。</span>
        <div className="row"><button className="btn" onClick={() => window.close()}>關閉</button><button className="btn primary" onClick={() => window.print()}>列印 / 存 PDF</button></div>
      </div>
      <div className="hd">
        <div className="row" style={{ gap: 12 }}>{co.logo && <img src={'/api/photo/' + co.logo} alt="" style={{ height: 40 }} />}
          <div><div style={{ fontSize: '14pt', fontWeight: 700 }}>{lang === 'en' ? co.name_en : co.name_zh}</div><div className="sub">{[co.address, co.phone && `${s.tel} ${co.phone}`, co.email, co.tax_id && `${s.taxid} ${co.tax_id}`].filter(Boolean).join(' · ')}</div></div></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: '14pt', fontWeight: 700 }}>{kind === 'pick' ? s.pick : s.title}</div><div>{o.order_no}</div></div>
        {kind === 'pick' && <QR value={'ORDER:' + o.order_no} size={64} />}
      </div>
      <div className="meta">
        <div><span className="sub">{s.to}</span><div><b>{c?.name || '—'}</b>{c?.contact ? ` · ${c.contact}` : ''}{c?.phone ? ` · ${c.phone}` : ''}</div>{c?.tax_id && <div className="sub">{s.taxid} {c.tax_id}</div>}</div>
        <div><span className="sub">{s.addr}</span><div>{o.address || '—'}</div></div>
        <div><span className="sub">{s.date}</span><div>{o.order_date}</div></div>
        <div><span className="sub">{s.delivery}</span><div>{o.delivery_date || '—'}</div></div>
      </div>
      {kind === 'customer' ? (<>
        <table>
          <thead><tr><th>{s.wine}</th><th>{s.vintage}</th><th className="r">{s.qty}</th><th className="r">{s.price}</th><th className="r">{s.disc}</th><th className="r">{s.amount}</th></tr></thead>
          <tbody>{d.lines.map((l) => <tr key={l.id}><td><b>{l.name}</b><div className="sub">{l.winery} · {l.volume_ml} ml</div></td><td>{l.vintage}</td><td className="r">{l.qty}</td><td className="r">{ntd(l.unit_price)}</td><td className="r">{l.discount ? l.discount + '%' : ''}</td><td className="r">{ntd(l.amount)}</td></tr>)}</tbody>
        </table>
        <div className="tot"><span>{s.subtotal}</span><span className="r">{ntd(d.totals.subtotal)}</span><span>{s.tax} {o.tax_rate}%</span><span className="r">{ntd(d.totals.tax)}</span>
          {d.totals.shipping > 0 && <><span>{s.ship}</span><span className="r">{ntd(d.totals.shipping)}</span></>}<b>{s.total}</b><b className="r" style={{ fontSize: '12pt' }}>{ntd(d.totals.total)}</b></div>
        {o.note && <div style={{ marginTop: 14 }}><span className="sub">{s.note}</span><div>{o.note}</div></div>}
        <div className="sub" style={{ marginTop: 24 }}>{s.thanks}</div>
      </>) : (<>
        <table>
          <thead><tr><th style={{ width: 24 }}></th><th>{s.wine}</th><th>{s.loc}</th><th className="r">{s.qty}</th><th>{s.bottles}</th></tr></thead>
          <tbody>{d.lines.flatMap((l) => {
            const groups = new Map();
            for (const b of l.held) { const k = b.location + (b.case_no ? ' › ' + b.case_no : ''); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b.bottle_no); }
            if (!groups.size) return [<tr key={l.id}><td><span className="box" /></td><td><b>{l.name}</b> {l.vintage}</td><td>{l.locations.map((x) => x.location + (x.case_no ? ' › ' + x.case_no : '')).join('、') || '—'}</td><td className="r">{l.qty}</td><td className="sub">{o.status === 'draft' ? '確認訂單後會指定瓶號' : ''}</td></tr>];
            return [...groups.entries()].map(([loc, nos], i) => <tr key={l.id + loc}><td><span className="box" /></td><td>{i === 0 ? <><b>{l.name}</b> {l.vintage}</> : ''}</td><td>{loc}</td><td className="r">{nos.length} {s.btl}</td><td className="sub">{nos.join(', ')}</td></tr>);
          })}</tbody>
        </table>
        <div className="row between" style={{ marginTop: 24 }}><span>共 {d.totals.bottles} 瓶</span><span>{s.done}：＿＿＿＿＿＿＿＿　日期：＿＿＿＿＿＿</span></div>
        <div className="sub" style={{ marginTop: 8 }}>可以拿同款的其他瓶；出貨時掃描實際拿出的瓶號即可，系統會自動更正。</div>
      </>)}
    </div>
  );
}
