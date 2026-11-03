import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, getBranch, setBranch, setUnauthorizedHandler, store } from './lib/api.js';
import { setCurrencySymbol } from './lib/format.js';

// ---- theme --------------------------------------------------------------------------
const THEME_KEY = 'salon.theme';
export function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
export function useTheme() {
  const [pref, setPref] = useState(() => store.get(THEME_KEY) || 'system');
  useEffect(() => {
    applyTheme(pref); store.set(THEME_KEY, pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => applyTheme('system');
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [pref]);
  return [pref, setPref];
}

// ---- toasts --------------------------------------------------------------------------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 5000 : 3000);
  }, []);
  const toast = useMemo(() => ({ info: (m) => push(m, 'info'), success: (m) => push(m, 'success'), error: (m) => push(m?.message || m, 'error') }), [push]);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---- auth / session ----------------------------------------------------------------------
// After a manual sign-out, skip auto-login for this tab so other roles can be tested
const noAuto = () => { try { return sessionStorage.getItem('salon.noauto') === '1'; } catch { return false; } };
const setNoAuto = (v) => { try { v ? sessionStorage.setItem('salon.noauto', '1') : sessionStorage.removeItem('salon.noauto'); } catch { /* storage blocked */ } };
const AuthCtx = createContext(null);
export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, salon: null, branches: [] });
  const [branch, setBranchState] = useState(getBranch());
  const [version, setVersion] = useState(0); // bump to make pages refetch after branch switch

  const load = useCallback(async () => {
    if (!getToken() && !noAuto()) {
      // Local testing: sign in automatically as the owner when the server allows it
      try { setToken((await api.post('/api/auth/auto-login')).token); } catch { /* not allowed or no owner yet */ }
    }
    if (!getToken()) return setState({ loading: false, user: null, salon: null, branches: [] });
    try {
      const me = await api.get('/api/auth/me');
      setCurrencySymbol(me.salon.currency_symbol);
      if (me.user.branch_id) { setBranch(me.user.branch_id); setBranchState(String(me.user.branch_id)); }
      else if (getBranch() !== 'all' && !me.branches.some((b) => String(b.id) === getBranch())) { setBranch('all'); setBranchState('all'); }
      setState({ loading: false, ...me });
    } catch {
      setToken(null);
      setState({ loading: false, user: null, salon: null, branches: [] });
    }
  }, []);

  useEffect(() => { setUnauthorizedHandler(() => { setToken(null); setState((s) => ({ ...s, user: null })); }); load(); }, [load]);

  const value = useMemo(() => ({
    ...state, branch, version,
    login: async (token) => { setNoAuto(false); setToken(token); await load(); },
    logout: () => { setNoAuto(true); setToken(null); setState({ loading: false, user: null, salon: null, branches: [] }); },
    refresh: load,
    switchBranch: (b) => { setBranch(b); setBranchState(String(b)); setVersion((v) => v + 1); },
    can: (mod) => !!state.user?.permissions?.includes(mod),
    branchName: branch === 'all' ? 'All branches' : state.branches.find((b) => String(b.id) === String(branch))?.name || '',
  }), [state, branch, version, load]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

// ---- data hook ------------------------------------------------------------------------------
/** Fetch JSON with loading/error state; refetches when deps or active branch change. */
export function useApi(url, params, deps = []) {
  const { version } = useAuth() || {};
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const key = url ? `${url}?${JSON.stringify(params || {})}` : null;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(url, params);
      if (my === seq.current) setState({ data, loading: false, error: null, key });
    } catch (e) {
      if (my === seq.current) setState({ data: null, loading: false, error: e, key });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, loading: state.loading || (!!key && state.key !== key), reload, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

/** Debounce a value (search boxes). */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
