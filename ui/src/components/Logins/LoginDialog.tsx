import { KeyRound, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { useUi } from '../../store/ui';
import { Dialog, Field } from '../common/Dialog';

/** A server asked for a login (IDM's authorization prompt): save it for the site and resume the download. */
export function LoginDialog() {
  const prompt = useUi((s) => s.loginPrompt);
  if (!prompt) return null;
  return <LoginForm key={`${prompt.downloadId}-${prompt.site}`} />;
}

function LoginForm() {
  const prompt = useUi((s) => s.loginPrompt)!;
  const [site, setSite] = useState(prompt.site);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => useUi.getState().set({ loginPrompt: null });
  const ok = site.trim() && username.trim();

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const saved = await attempt(() => api.addLogin(site.trim(), username.trim(), password), 'Could not save the login');
    if (saved && prompt.downloadId) await attempt(() => api.bulk([prompt.downloadId!], 'start'), 'Could not resume the download');
    setBusy(false);
    if (saved) close();
  };

  return (
    <Dialog
      title={prompt.failed ? 'Login refused' : 'Login required'}
      icon={<KeyRound size={18} className="text-accent" />}
      width={460}
      onClose={close}
      onSubmit={submit}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ok || busy} onClick={submit}>
            {busy && <LoaderCircle size={16} className="spin" />}
            {prompt.downloadId ? 'Save and resume' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form">
        <p className="muted login-intro">
          {prompt.failed ? 'The site refused the saved username or password. Enter the right ones.' : 'This site needs a username and password to download the file.'}
          {prompt.realm && (
            <>
              {' '}
              It says: <strong>“{prompt.realm}”</strong>.
            </>
          )}
        </p>
        <Field label="Site" hint="Start with a dot (.example.com) to use it for every subdomain.">
          <input className="input" value={site} onChange={(e) => setSite(e.target.value)} spellCheck={false} />
        </Field>
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
        </Field>
        <Field label="Password" hint="Saved encrypted on this computer. Manage saved logins in Options → Site logins.">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Dialog>
  );
}
