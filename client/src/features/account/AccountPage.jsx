import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiError, setSession } from '../../lib/api';
import { Alert, Button, Card, Field } from '../../components/ui';
import { useAuth } from '../auth/auth-context';

// Data protection rights for every signed-in user: download everything held about you
// (access), and delete your account (erasure). See the privacy page for what each means.
function DownloadData() {
  const [state, setState] = useState(null);

  async function download() {
    setState({ busy: true });
    try {
      const res = await api.get('/account/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState({ tone: 'success', text: 'Your data was downloaded as a JSON file.' });
    } catch (err) {
      setState({ tone: 'error', text: apiError(err).message });
    }
  }

  return (
    <Card title="Download your data">
      <p>
        One file with everything we hold about you: your account, profile, applications and their history, internships, evaluations, notifications
        and sign-in activity.
      </p>
      {state?.text && <Alert tone={state.tone}>{state.text}</Alert>}
      <Button variant="secondary" busy={state?.busy} onClick={download}>
        Download my data
      </Button>
    </Card>
  );
}

function DeleteAccount() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user.role === 'admin') {
    return (
      <Card title="Delete your account">
        <p className="muted">Admin accounts can't delete themselves. Ask another admin to remove yours.</p>
      </Card>
    );
  }

  // A password account confirms with its password; a Google-only account by typing its email.
  const byPassword = user.hasPassword !== false;

  async function onDelete(e) {
    e.preventDefault();
    setError(null);
    if (!window.confirm('Delete your account permanently? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.post('/account/delete', byPassword ? { password: value } : { confirmEmail: value });
      setSession(null);
      queryClient.clear();
      navigate('/login?accountDeleted=1', { replace: true });
    } catch (err) {
      const { message, fields } = apiError(err);
      setError(fields.password ?? fields.confirmEmail ?? message);
      setBusy(false);
    }
  }

  return (
    <Card title="Delete your account">
      <p>Deleting your account erases your personal data straight away:</p>
      <ul>
        <li>your name, email address, phone number and sign-in details;</li>
        <li>your profile, resume, cover letters, certificates and notifications.</li>
      </ul>
      <p className="muted">
        Records other people rely on are kept without your details, shown as “Deleted user”: a company's history of applications, evaluations a
        supervisor wrote, and the security log. You can register again later with the same email address. <Link to="/privacy">More on how we handle data</Link>.
      </p>
      <form onSubmit={onDelete} className="stack">
        <Field label={byPassword ? 'Your password' : `Type your email address (${user.email}) to confirm`} error={error}>
          {(a11y) => (
            <input
              type={byPassword ? 'password' : 'email'}
              autoComplete={byPassword ? 'current-password' : 'off'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              {...a11y}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="danger" busy={busy} disabled={!value}>
            Delete my account
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AccountPage() {
  const { user } = useAuth();
  return (
    <main className="page page--medium">
      <h1>Your account</h1>
      <p className="muted">
        Signed in as {user.email}
        {user.googleLinked && ' · Google sign-in linked'}
      </p>
      <div className="stack">
        <DownloadData />
        <DeleteAccount />
      </div>
    </main>
  );
}
