import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ntd } from '../api.js';
import { receive } from '../handoff.js';

const L = {
  zh: { title: '酒款推薦', name: '品名', winery: '酒莊', vintage: '年份', region: '產區', qty: '瓶數', suggested_price: '建議售價', price: '市場價格', location: '位置', cases: '箱號', type: '種類', volume_ml: '容量', cost: '採購價格', merchants: '酒商', page: '共 {n} 款', btl: '瓶' },
  en: { title: 'Wine selection', name: 'Wine', winery: 'Winery', vintage: 'Vintage', region: 'Region', qty: 'Bottles', suggested_price: 'Price', price: 'Market price', location: 'Location', cases: 'Cases', type: 'Type', volume_ml: 'Volume', cost: 'Cost', merchants: 'Merchant', page: '{n} wines', btl: 'btl' },
};

export default function PrintExport() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const req = receive(sp.get('k'));
  const [data, setData] = useState(null);
  const lang = req?.lang === 'en' ? 'en' : 'zh';
  const s = L[lang];
  useEffect(() => {
    if (!req) return;
    api('/api/export/data', { method: 'POST', body: { ...req, log: true } }).then((d) => { setData(d); setTimeout(() => window.print(), 700); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!req) return <div className="page">—</div>;
  if (!data) return <div className="page muted">…</div>;
  const co = data.company;
  const cols = req.cols;
  const money = (v) => (v == null ? '—' : ntd(v));
  const cell = (r, c) => ({
    name: <><b>{r.name}</b><div className="sub">{r.winery}</div></>, vintage: <>{r.vintage}<div className="sub">{r.region}</div></>, qty: r.qty,
    suggested_price: money(r.suggested_price), price: money(r.price), location: <>{r.location}<div className="sub">{r.cases}</div></>,
    type: lang === 'en' ? r.type_en : r.type_zh, volume_ml: r.volume_ml + ' ml',
  }[c]);
  const head = { name: s.name, vintage: s.vintage, qty: s.qty, suggested_price: s.suggested_price, price: s.price, location: s.location, type: s.type, volume_ml: s.volume_ml };
  return (
    <div className="doc">
      <style>{`@page { size: A4; margin: 14mm 12mm; }
        .doc { max-width: 190mm; margin: 0 auto; padding: 16px; background: #fff; color: #111; font-size: 10pt; }
        .doc .hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #7B2342; padding-bottom: 8px; margin-bottom: 14px; }
        .doc table { width: 100%; border-collapse: collapse; }
        .doc th { text-align: left; font-size: 8.5pt; color: #555; border-bottom: 1px solid #999; padding: 6px 6px; }
        .doc td { border-bottom: 1px solid #ddd; padding: 6px; vertical-align: top; break-inside: avoid; }
        .doc .sub { color: #666; font-size: 8.5pt; }
        .doc .cat { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .doc .item { display: flex; gap: 10px; border: 1px solid #ddd; border-radius: 6px; padding: 8px; break-inside: avoid; }
        .doc .item img, .doc .item .ph { width: 26mm; height: 34mm; object-fit: cover; border-radius: 4px; background: #f3f0ee; flex: none; }
        @media print { .no-print { display: none !important; } .doc { padding: 0; } }`}</style>
      <div className="no-print row between card" style={{ marginBottom: 16 }}>
        <span>{lang === 'en' ? 'Choose “Save as PDF” in the print dialog.' : '在列印視窗選「另存為 PDF」即可存檔。'}</span>
        <div className="row"><button className="btn" onClick={() => nav(-1)}>{lang === 'en' ? 'Back' : '返回'}</button><button className="btn primary" onClick={() => window.print()}>{lang === 'en' ? 'Print / PDF' : '列印 / 存 PDF'}</button></div>
      </div>
      <div className="hd">
        <div className="row" style={{ gap: 12 }}>
          {co.logo && <img src={'/api/photo/' + co.logo} alt="" style={{ height: 40 }} />}
          <div><div style={{ fontSize: '14pt', fontWeight: 700 }}>{lang === 'en' ? co.name_en : co.name_zh}</div><div className="sub">{[co.phone, co.email, co.address].filter(Boolean).join(' · ')}</div></div>
        </div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: '13pt', fontWeight: 700 }}>{s.title}</div><div className="sub">{data.title ? data.title + ' · ' : ''}{new Date().toISOString().slice(0, 10)}</div></div>
      </div>
      {req.layout === 'catalog' ? (
        <div className="cat">{data.rows.map((r) => (
          <div className="item" key={r.wine_no}>
            {r.photo ? <img src={'/api/photo/' + r.photo} alt="" /> : <div className="ph" />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <b>{r.name}</b><span className="sub">{r.winery} · {r.vintage} · {r.region}</span>
              {cols.includes('qty') && <span>{r.qty} {s.btl}</span>}
              {cols.includes('suggested_price') && r.suggested_price != null && <span><b>{money(r.suggested_price)}</b></span>}
              {cols.includes('price') && <span className="sub">{s.price} {money(r.price)}</span>}
              {req.cost && <span className="sub">{s.cost} {money(r.cost)} · {r.merchants}</span>}
            </div>
          </div>))}</div>
      ) : (
        <table>
          <thead><tr>{cols.map((c) => <th key={c} style={{ textAlign: ['qty', 'suggested_price', 'price'].includes(c) ? 'right' : 'left' }}>{head[c]}</th>)}{req.cost && <><th style={{ textAlign: 'right' }}>{s.cost}</th><th>{s.merchants}</th></>}</tr></thead>
          <tbody>{data.rows.map((r) => <tr key={r.wine_no}>{cols.map((c) => <td key={c} style={{ textAlign: ['qty', 'suggested_price', 'price'].includes(c) ? 'right' : 'left', whiteSpace: ['qty', 'suggested_price', 'price'].includes(c) ? 'nowrap' : 'normal' }}>{cell(r, c)}</td>)}
            {req.cost && <><td style={{ textAlign: 'right' }}>{money(r.cost)}</td><td>{r.merchants}</td></>}</tr>)}</tbody>
        </table>
      )}
      <div className="sub" style={{ marginTop: 12 }}>{s.page.replace('{n}', data.rows.length)}</div>
    </div>
  );
}
