import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiError } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { Alert, Button, Card, Field, StatusBadge } from '../../components/ui';
import { email } from '../auth/schemas';
import { useAddStaff, useResendInvite, useStaff } from './api';

const staffSchema = z.object({ fullName: z.string().trim().min(2, 'Full name is required').max(120), email });

// US-09: supervisors are added by the company and get an email to set their password.
function AddSupervisor() {
  const add = useAddStaff();
  const [message, setMessage] = useState(null);
  const form = useForm({ resolver: zodResolver(staffSchema), defaultValues: { fullName: '', email: '' } });
  const { register, handleSubmit, formState, reset } = form;

  const onSubmit = handleSubmit(async (values) => {
    setMessage(null);
    try {
      const member = await add.mutateAsync(values);
      reset();
      setMessage({ tone: 'success', text: `Invitation sent to ${member.email}. They can sign in once they set a password.` });
    } catch (err) {
      setMessage({ tone: 'error', text: applyServerErrors(err, form.setError, ['fullName', 'email']).message });
    }
  });

  return (
    <Card title="Add a supervisor">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <form onSubmit={onSubmit} noValidate className="stack">
        <div className="grid-2">
          <Field label="Full name" error={formState.errors.fullName?.message}>
            {(a11y) => <input autoComplete="off" {...a11y} {...register('fullName')} />}
          </Field>
          <Field label="Work email" error={formState.errors.email?.message}>
            {(a11y) => <input type="email" autoComplete="off" {...a11y} {...register('email')} />}
          </Field>
        </div>
        <div>
          <Button type="submit" busy={formState.isSubmitting}>
            Send invitation
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function StaffPage() {
  const { data, isPending, isError } = useStaff();
  const resend = useResendInvite();
  const [message, setMessage] = useState(null);

  async function onResend(member) {
    setMessage(null);
    try {
      await resend.mutateAsync(member.id);
      setMessage({ tone: 'success', text: `A new invitation is on its way to ${member.email}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err).message });
    }
  }

  return (
    <main className="page">
      <h1>Staff</h1>
      <AddSupervisor />
      <Card title="Your team">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {isPending && <p className="muted">Loading…</p>}
        {isError && <Alert>Could not load your staff.</Alert>}
        {data && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Current interns</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.fullName ?? m.email}
                    {m.fullName && <div className="muted small">{m.email}</div>}
                  </td>
                  <td>{m.memberRole === 'rep' ? 'Representative' : 'Supervisor'}</td>
                  <td>{m.memberRole === 'supervisor' ? m.activeInterns : '—'}</td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="actions">
                    {m.status === 'invited' && (
                      <Button variant="link" busy={resend.isPending && resend.variables === m.id} onClick={() => onResend(m)}>
                        Resend invitation
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
