const TOKEN_KEY = 'salon.token';
const BRANCH_KEY = 'salon.branch';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
export const getToken = () => store.get(TOKEN_KEY);
export const setToken = (t) => store.set(TOKEN_KEY, t);
export const getBranch = () => store.get(BRANCH_KEY) || 'all';
export const setBranch = (b) => store.set(BRANCH_KEY, String(b));
export { store };

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body, { raw = false, isForm = false, token: tokenOverride } = {}) {
  const headers = { 'X-Branch-Id': getBranch() };
  const token = tokenOverride !== undefined ? tokenOverride : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Network error — check your connection');
  }
  if (res.status === 401 && token && tokenOverride === undefined && !url.startsWith('/api/auth/login')) onUnauthorized();
  if (raw) { if (!res.ok) throw new ApiError(res.status, 'Download failed'); return res; }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 300) return data; // e.g. login: choose which salon
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  return data;
}

const qs = (params) => {
  if (!params) return '';
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, file) => { const f = new FormData(); f.append('file', file); return request('POST', url, f, { isForm: true }); },
  blob: async (url) => (await request('GET', url, undefined, { raw: true })).blob(),
};

// ---- platform owner panel (separate session from salon logins) ----------------------------------
const PLATFORM_KEY = 'salon.platformToken';
export const getPlatformToken = () => store.get(PLATFORM_KEY);
export const setPlatformToken = (t) => store.set(PLATFORM_KEY, t);
const pt = () => getPlatformToken() || '';
export const platformApi = {
  get: (url, params) => request('GET', url + qs(params), undefined, { token: pt() }),
  post: (url, body = {}) => request('POST', url, body, { token: pt() }),
  put: (url, body = {}) => request('PUT', url, body, { token: pt() }),
  del: (url, body) => request('DELETE', url, body, { token: pt() }),
};
