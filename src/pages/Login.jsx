import { useContext, useState } from 'react';
import { api } from '../api.js';
import { LangCtx, useT } from '../i18n.jsx';
import Icon from '../icons.jsx';
import { PasswordInput } from '../ui.jsx';
import { useCompany, companyName } from '../company.js';

export default function Login({ onLogin }) {
  const t = useT();
  const { lang, setLang } = useContext(LangCtx);
  const company = useCompany();
  const [login, setLogin] = useState('');
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { onLogin(await api('/api/login', { method: 'POST', body: { login, password: pw, remember } })); }
    catch (x) { setErr(x.message); setPw(''); }
    finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="row between">
          <div className="row"><Icon n="glass" s={32} c="#7B2342" /><div><h1 style={{ fontSize: 20 }}>{t('appName')}</h1><div className="muted small">{companyName(company, lang !== 'en')}</div></div></div>
          <div className="seg"><button type="button" className={lang !== 'en' ? 'on' : ''} onClick={() => setLang('zh')}>中</button><button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div>
        </div>
        <label className="f">{t('loginName')}<input className="input" autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus /></label>
        <label className="f">{t('password')}<PasswordInput zh={lang !== 'en'} inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value.replace(/\D/g, ''))} required /></label>
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />{t('remember')}</label>
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy || !login || pw.length !== 6}>{t('login')}</button>
        <div className="muted small">{lang === 'en' ? 'Forgot your password? Ask a colleague to reset it in Settings.' : '忘記密碼？請同事在「設定 › 使用者」重設。'}</div>
      </form>
    </div>
  );
}
