export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith('/login')) window.dispatchEvent(new Event('mywines:logout'));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText, data);
  return data;
}

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== '' && v != null && v !== false && !(Array.isArray(v) && !v.length)) p.set(k, Array.isArray(v) ? v.join(',') : v);
  const s = p.toString();
  return s ? '?' + s : '';
};

export const ntd = (n) => (n == null ? '—' : 'NT$' + Math.round(n).toLocaleString('en-US'));
export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
