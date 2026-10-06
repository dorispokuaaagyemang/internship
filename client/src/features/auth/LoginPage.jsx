import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, apiError } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { Alert, Button, Field } from '../../components/ui';
import { useAuth } from './auth-context';
import { loginSchema } from './schemas';
import { GoogleButton } from './GoogleButton';

// Messages for the ?error= codes the API redirects with (email links, Google sign-in).
const REDIRECT_ERRORS = {
  email_link_invalid: 'That verification link is not valid. Sign in to request a new one.',
  email_link_expired: 'That verification link has expired. Sign in to request a new one.',
  google_denied: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Please try again.',
  google_email_unverified: 'Your Google account email is not verified, so it cannot be used to sign in.',
  google_unavailable: 'Google sign-in is not available right now.',
  account_suspended: 'This account is suspended.',
};

export function LoginPage() {
  const { login } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState(REDIRECT_ERRORS[params.get('error')] ?? null);
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);
  const [resent, setResent] = useState(false);
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const { register, handleSubmit, formState } = form;

  // On success the session changes and GuestOnly redirects (to ?next=, /verify or the role's home).
  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setUnverifiedEmail(null);
    try {
      await login(values);
    } catch (err) {
      const { code, message } = applyServerErrors(err, form.setError, ['email', 'password']);
      if (code === 'EMAIL_NOT_VERIFIED') setUnverifiedEmail(values.email);
      setError(message);
    }
  });

  // US-01: an unverified email blocks sign-in; offer a fresh link right here.
  async function resend() {
    try {
      await api.post('/auth/verify-email/resend', { email: unverifiedEmail });
      setResent(true);
    } catch (err) {
      setError(apiError(err).message);
    }
  }

  return (
    <main className="page page--narrow">
      <h1>Sign in</h1>
      {params.get('emailVerified') && <Alert tone="success">Your email is verified. You can sign in now.</Alert>}
      <Alert>{error}</Alert>
      {unverifiedEmail && (
        <div className="inline-actions">
          {resent ? (
            <p className="muted">A new link is on its way to {unverifiedEmail}.</p>
          ) : (
            <Button type="button" variant="secondary" onClick={resend}>
              Resend verification email
            </Button>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="stack">
        <Field label="Email" error={formState.errors.email?.message}>
          {(a11y) => <input type="email" autoComplete="email" {...a11y} {...register('email')} />}
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          {(a11y) => <input type="password" autoComplete="current-password" {...a11y} {...register('password')} />}
        </Field>
        <Button type="submit" busy={formState.isSubmitting}>
          Sign in
        </Button>
      </form>

      <div className="divider">or</div>
      <GoogleButton intent="student">Continue with Google</GoogleButton>

      <p className="muted">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </main>
  );
}
