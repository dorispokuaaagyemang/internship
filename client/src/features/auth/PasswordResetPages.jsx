import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { Alert, Button, Field, PasswordInput } from '../../components/ui';
import { useAuth } from './auth-context';
import { email, password } from './schemas';

const forgotSchema = z.object({ email });
const resetSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'The passwords do not match', path: ['confirm'] });

// US-01: asks for a reset link. The API answers the same whether or not the account exists.
export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } });
  const { register, handleSubmit, formState } = form;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/password/forgot', values);
      setSentTo(values.email);
    } catch (err) {
      setError(applyServerErrors(err, form.setError, ['email']).message);
    }
  });

  return (
    <main className="page page--narrow">
      <h1>Forgot your password?</h1>
      {sentTo ? (
        <>
          <Alert tone="success">
            If an account uses {sentTo}, a link to choose a new password is on its way. It works once, within an hour.
          </Alert>
          <p className="muted">Nothing arrived? Check your spam folder, or try again in a minute.</p>
        </>
      ) : (
        <>
          <p>Enter the email address you sign in with and we'll send you a link to choose a new password.</p>
          <Alert>{error}</Alert>
          <form onSubmit={onSubmit} noValidate className="stack">
            <Field label="Email" error={formState.errors.email?.message}>
              {(a11y) => <input type="email" autoComplete="email" {...a11y} {...register('email')} />}
            </Field>
            <Button type="submit" busy={formState.isSubmitting}>
              Send reset link
            </Button>
          </form>
        </>
      )}
      <p className="muted">
        Remembered it? <Link to="/login">Sign in</Link>
      </p>
    </main>
  );
}

// US-01: the emailed link. Setting the password signs out every session, so the user signs in again.
export function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { status, logout } = useAuth();
  const [error, setError] = useState(null);
  const [linkBroken, setLinkBroken] = useState(false);
  const form = useForm({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });
  const { register, handleSubmit, formState } = form;

  const onSubmit = handleSubmit(async ({ password: value }) => {
    setError(null);
    try {
      await api.post('/auth/password/reset', { token, password: value });
      if (status === 'signedIn') await logout();
      navigate('/login?passwordReset=1', { replace: true });
    } catch (err) {
      const { code, message } = applyServerErrors(err, form.setError, ['password']);
      setLinkBroken(code === 'RESET_LINK_INVALID' || code === 'RESET_LINK_EXPIRED');
      setError(message);
    }
  });

  return (
    <main className="page page--narrow">
      <h1>Choose a new password</h1>
      <Alert>{error}</Alert>
      {linkBroken ? (
        <p>
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="stack">
          <Field label="New password" error={formState.errors.password?.message} hint="At least 8 characters, with a number and a special character.">
            {(a11y) => <PasswordInput autoComplete="new-password" {...a11y} {...register('password')} />}
          </Field>
          <Field label="Confirm new password" error={formState.errors.confirm?.message}>
            {(a11y) => <PasswordInput autoComplete="new-password" {...a11y} {...register('confirm')} />}
          </Field>
          <Button type="submit" busy={formState.isSubmitting}>
            Set new password
          </Button>
        </form>
      )}
    </main>
  );
}
