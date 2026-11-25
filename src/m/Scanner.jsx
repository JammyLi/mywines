import { setupUrl } from '../version.js';
// 相機掃描 QR Code：優先用瀏覽器內建 BarcodeDetector，沒有就用 jsQR
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(); const g = a.createGain();
    o.frequency.value = 1200; g.gain.value = 0.08; o.connect(g); g.connect(a.destination);
    o.start(); setTimeout(() => { o.stop(); a.close(); }, 90);
  } catch { /* */ }
  navigator.vibrate?.(60);
}

export default function Scanner({ onCode, zh = true, paused = false }) {
  const video = useRef();
  const canvas = useRef();
  const last = useRef({ code: '', at: 0 });
  const [err, setErr] = useState('');
  const [on, setOn] = useState(false);
  const cb = useRef(onCode); cb.current = onCode;
  const pausedRef = useRef(paused); pausedRef.current = paused;

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setErr('https'); return; }
    let stream, raf, stop = false, detector = null;
    if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; } }
    const hit = (code) => {
      const now = Date.now();
      if (code === last.current.code && now - last.current.at < 2500) return;
      last.current = { code, at: now };
      beep(); cb.current(code.trim());
    };
    const loop = async () => {
      if (stop) return;
      const v = video.current;
      if (v && v.readyState >= 2 && !pausedRef.current) {
        try {
          if (detector) { const r = await detector.detect(v); if (r[0]?.rawValue) hit(r[0].rawValue); }
          else {
            const c = canvas.current; const w = 480, hgt = Math.round((v.videoHeight / v.videoWidth) * 480) || 360;
            c.width = w; c.height = hgt; const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, w, hgt);
            const img = ctx.getImageData(0, 0, w, hgt);
            const r = jsQR(img.data, w, hgt, { inversionAttempts: 'dontInvert' });
            if (r?.data) hit(r.data);
          }
        } catch { /* 單一畫格失敗不影響 */ }
      }
      raf = setTimeout(loop, 180);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => { stream = s; if (stop) { s.getTracks().forEach((t) => t.stop()); return; } video.current.srcObject = s; video.current.play().catch(() => {}); setOn(true); loop(); })
      .catch((e) => setErr(e.name === 'NotAllowedError' ? 'denied' : 'nocam'));
    return () => { stop = true; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  if (err) return (
    <div className="scanbox msg">
      {err === 'https' ? <>{zh ? '相機掃描需要安全連線（HTTPS）。' : 'Camera scanning needs HTTPS.'}<a href={setupUrl()}>{zh ? '照「手機設定」步驟開啟 ›' : 'Phone setup ›'}</a></>
        : err === 'denied' ? (zh ? '沒有相機權限。請到瀏覽器設定允許使用相機，或用下方手動輸入。' : 'Camera permission denied.')
          : (zh ? '找不到相機，請用下方手動輸入。' : 'No camera found.')}
    </div>
  );
  return (
    <div className="scanbox">
      <video ref={video} playsInline muted />
      <canvas ref={canvas} hidden />
      <div className="aim" />
      {!on && <div className="msg">{zh ? '開啟相機中…' : 'Starting camera…'}</div>}
    </div>
  );
}
