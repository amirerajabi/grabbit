import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SiteLogin } from '../../../../shared/protocol';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { formatDate } from '../../lib/format';
import { Field } from '../common/Dialog';

/** Options → Site logins: saved usernames per site (passwords are never shown) and a form to add one. */
export function LoginsSection() {
  const [logins, setLogins] = useState<SiteLogin[] | null>(null);
  const [site, setSite] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const reload = () => void attempt(() => api.logins().then(setLogins), 'Could not load the saved logins');
  useEffect(reload, []);

  const add = async () => {
    if (!site.trim() || !username.trim()) return;
    if (await attempt(() => api.addLogin(site.trim(), username.trim(), password), 'Could not save the login')) {
      setSite('');
      setUsername('');
      setPassword('');
      reload();
    }
  };

  return (
    <div className="settings-section">
      <h3>Site logins</h3>
      <p className="muted section-intro">
        For sites that ask for a username and password before a download. Grabbit answers them for you, and asks when it doesn't have one. Passwords are stored encrypted on this computer and never shown again.
      </p>
      <div className="login-list" role="list">
        {logins === null ? null : logins.length === 0 ? (
          <div className="muted login-empty">No saved logins yet.</div>
        ) : (
          logins.map((l) => (
            <div key={l.id} className="login-row" role="listitem">
              <KeyRound size={16} className="muted" />
              <span className="login-site">{l.site.startsWith('.') ? `${l.site.slice(1)} and subdomains` : l.site}</span>
              <span className="muted">{l.username}</span>
              <span className="muted login-date">{formatDate(l.addedAt)}</span>
              <button className="icon-btn xs danger" title="Delete this login" aria-label={`Delete the login for ${l.site}`} onClick={() => attempt(() => api.removeLogin(l.id).then(reload))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
      <h3 className="settings-subhead">Add a login</h3>
      <div className="form-row three">
        <Field label="Site">
          <input className="input" value={site} onChange={(e) => setSite(e.target.value)} placeholder="files.example.com" spellCheck={false} />
        </Field>
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Password">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && void add()} />
        </Field>
      </div>
      <div>
        <button className="btn" disabled={!site.trim() || !username.trim()} onClick={() => void add()}>
          <Plus size={16} /> Save login
        </button>
      </div>
    </div>
  );
}
