import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { receive } from '../handoff.js';
import { run } from '../ui.jsx';
import { Label, labelKey, DEF_SIZE, PAPERS, sheetLayout, MARGIN, GAP } from './Labels.jsx';

export default function PrintLabels() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const data = receive(sp.get('k'));
  const [asked, setAsked] = useState(false);
  const zh = (localStorage.getItem('lang') || 'zh') !== 'en';
  useEffect(() => {
    if (!data) return;
    const after = () => setAsked(true);
    window.addEventListener('afterprint', after);
    const tm = setTimeout(() => window.print(), 600); // 等 QR Code 產生
    return () => { window.removeEventListener('afterprint', after); clearTimeout(tm); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="page">{zh ? '沒有要列印的資料' : 'Nothing to print'}</div>;
  const big = data.kind !== 'bottle';
  const sz = data.size || (big ? DEF_SIZE.big : DEF_SIZE.bottle);
  // 一般印表機：A4／Letter 一頁排多張，沿虛線剪下
  const sheet = data.mode === 'sheet';
  const paper = PAPERS[data.paper] || PAPERS.A4;
  const { cols, perPage } = sheetLayout(sz, paper);
  const mark = async () => {
    await run(() => api('/api/labels/printed', { method: 'POST', body: { kind: data.kind, codes: data.labels.map((x) => labelKey(data.kind, x)) } }), zh ? '已標記為已列印' : 'Marked as printed');
    nav(-1);
  };
  return (
    <div className="print-root">
      {sheet
        ? <style>{`@page { size: ${paper.w}mm ${paper.h}mm; margin: ${MARGIN}mm; }
        .print-root .sheet { display: grid; grid-template-columns: repeat(${cols}, ${sz.w}mm); gap: ${GAP}mm; justify-content: start; }
        .print-root .lbl { border: 0.2mm dashed #999; border-radius: 0; margin: 0; break-inside: avoid; page-break-inside: avoid; }
        @media screen { .print-root { padding: 16px; background: #eee; min-height: 100vh; } .print-root .sheet { background: #fff; padding: ${MARGIN}mm; width: ${paper.w}mm; box-sizing: border-box; } }
        @media print { .print-bar { display: none !important; } body { margin: 0; } }`}</style>
        : <style>{`@page { size: ${sz.w}mm ${sz.h}mm; margin: 0; }
        .print-root .lbl { border: 0; border-radius: 0; break-after: page; page-break-after: always; margin: 0; }
        @media screen { .print-root { padding: 16px; background: #eee; min-height: 100vh; } .print-root .sheet { display: flex; flex-wrap: wrap; gap: 8px; } .print-root .lbl { border: 1px dashed #aaa; } }
        @media print { .print-bar { display: none !important; } body { margin: 0; } }`}</style>}
      <div className="print-bar card row between" style={{ marginBottom: 16, position: 'sticky', top: 8, zIndex: 2 }}>
        <span>{asked ? (zh ? '標籤印好了嗎？' : 'Did the labels print?') : (zh ? `${data.labels.length} 張標籤` : `${data.labels.length} labels`)}{sheet && <span className="muted small">（{zh ? `一般印表機 ${data.paper || 'A4'}，每頁 ${perPage} 張，共 ${Math.ceil(data.labels.length / Math.max(perPage, 1))} 頁` : `${data.paper || 'A4'}, ${perPage} per page`}）</span>}</span>
        <div className="row">
          <button className="btn" onClick={() => nav(-1)}>{zh ? '返回' : 'Back'}</button>
          <button className="btn" onClick={() => window.print()}>{zh ? '再印一次' : 'Print again'}</button>
          <button className="btn primary" onClick={mark}>{zh ? '已印好，標記為已列印' : 'Printed — mark as done'}</button>
        </div>
      </div>
      <div className="sheet">{data.labels.map((x) => <Label key={labelKey(data.kind, x)} kind={data.kind} x={x} size={sz} />)}</div>
    </div>
  );
}
