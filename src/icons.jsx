const P = {
  dash: <path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  storage: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18" /></>,
  lists: <><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  price: <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  import: <><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 21h16" /></>,
  labels: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9v6M10 9v6M13 9v6M17 9v6" /></>,
  log: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  glass: <><path d="M7 2h10l-1 7a4 4 0 0 1-8 0z" /><path d="M12 13v8" /><path d="M8 21h8" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M7 12h10" /></>,
  count: <><path d="M9 5h10M9 12h10M9 19h10" /><path d="M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2" /></>,
  order: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 7h6M9 11h6" /></>,
  out: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></>,
};
export default function Icon({ n, s = 18, c = 'currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[n]}</svg>;
}
