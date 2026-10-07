import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError, setSession } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { Alert, Button, Field, PageLoading } from '../../components/ui';
import { homeFor, useAuth } from './auth-context';
import { password } from './schemas';

const schema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'The passwords do not match', path: ['confirm'] });

// US-09: a supervisor added by their company opens the emailed link, sets a password and is
// signed in. Opening the link proves the email, so there is no separate verification step.
export function AcceptInvitePage() {
  const { token } = useParams();
  const { status, user } = useAuth();
  const [error, setError] = useState(null);
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: async () => (await api.get(`/auth/invite/${token}`)).data.invite,
    retry: false,
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const { register, handleSubmit, formState } = form;

  // Accepting signs the supervisor in; from then on this page just moves them along.
  if (status === 'signedIn' && user.role === 'supervisor' && user.status === 'active') return <Navigate to={homeFor(user)} replace />;

  const onSubmit = handleSubmit(async ({ password: value }) => {
    setError(null);
    try {
      const { data } = await api.post('/auth/invite/accept', { token, password: value });
      setSession(data);
    } catch (err) {
      setError(applyServerErrors(err, form.setError, ['password']).message);
    }
  });

  if (invite.isPending) return <PageLoading />;
  if (invite.isError) {
    return (
      <main className="page page--narrow">
        <h1>Invitation unavailable</h1>
        <Alert>{apiError(invite.error).message}</Alert>
        <p>
          Already set your password? <Link to="/login">Sign in</Link>
        </p>
      </main>
    );
  }

  const { email, fullName, companyName } = invite.data;
  return (
    <main className="page page--narrow">
      <h1>Welcome{fullName ? `, ${fullName}` : ''}</h1>
      <p>
        <strong>{companyName ?? 'Your company'}</strong> added you as a supervisor. Set a password for <strong>{email}</strong> to get started.
      </p>
      <Alert>{error}</Alert>
      <form onSubmit={onSubmit} noValidate className="stack">
        <Field label="Password" error={formState.errors.password?.message} hint="At least 8 characters, with a number and a special character.">
          {(a11y) => <input type="password" autoComplete="new-password" {...a11y} {...register('password')} />}
        </Field>
        <Field label="Confirm password" error={formState.errors.confirm?.message}>
          {(a11y) => <input type="password" autoComplete="new-password" {...a11y} {...register('confirm')} />}
        </Field>
        <Button type="submit" busy={formState.isSubmitting}>
          Set password and continue
        </Button>
      </form>
    </main>
  );
}
