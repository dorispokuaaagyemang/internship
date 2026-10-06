import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiError } from '../../lib/api';
import { Alert, Button, Card } from '../../components/ui';
import { homeFor, useAuth } from './auth-context';

// US-01: a password account confirms its email through the link we sent, then it is active.
// (SMS phone verification, US-00B, was dropped on 2026-10-06.)
export function VerifyPage() {
  const { user, reloadUser } = useAuth();
  const [state, setState] = useState(null);

  // The link is opened in another tab, so pick up the change when this one regains focus.
  useEffect(() => {
    reloadUser().catch(() => {});
    const onFocus = () => reloadUser().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reloadUser]);

  if (user.status === 'active') {
    return (
      <main className="page page--narrow">
        <h1>You are all set</h1>
        <p>Your email is confirmed.</p>
        <Link className="btn btn--primary" to={homeFor(user)}>
          Continue
        </Link>
      </main>
    );
  }

  async function resend() {
    try {
      await api.post('/auth/verify-email/resend', { email: user.email });
      setState({ tone: 'success', text: `A new link is on its way to ${user.email}.` });
    } catch (err) {
      setState({ tone: 'error', text: apiError(err).message });
    }
  }

  return (
    <main className="page page--narrow">
      <h1>Confirm your email address</h1>
      <Card>
        <p>
          We sent a link to <strong>{user.email}</strong>. Open it to confirm your address, then come back here.
        </p>
        {state && <Alert tone={state.tone}>{state.text}</Alert>}
        <div className="inline-actions">
          <Button type="button" variant="secondary" onClick={() => reloadUser().catch(() => {})}>
            I have confirmed it
          </Button>
          <Button type="button" variant="link" onClick={resend}>
            Resend the link
          </Button>
        </div>
      </Card>
    </main>
  );
}
