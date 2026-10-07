import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { applyServerErrors } from '../../lib/forms';
import { Alert, Button, Field } from '../../components/ui';
import { useAuth } from './auth-context';
import { registerSchema } from './schemas';
import { GoogleButton } from './GoogleButton';

const FIELDS = ['fullName', 'role', 'email', 'password', 'phone'];

// US-01 (students) and US-04 (companies). The account starts pending; on success the session
// changes and GuestOnly moves on to /verify until the email link is opened.
export function RegisterPage() {
  const { register: createAccount } = useAuth();
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', role: 'student', email: '', password: '', phone: '' },
  });
  const { register, handleSubmit, formState, control } = form;
  const role = useWatch({ control, name: 'role' });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await createAccount({ ...values, phone: values.phone.replace(/[\s-]/g, '') });
    } catch (err) {
      setError(applyServerErrors(err, form.setError, FIELDS).message);
    }
  });

  return (
    <main className="page page--narrow">
      <h1>Create an account</h1>
      <Alert>{error}</Alert>

      <form onSubmit={onSubmit} noValidate className="stack">
        <fieldset className="choice">
          <legend>I am</legend>
          <label>
            <input type="radio" value="student" {...register('role')} /> A student looking for an internship
          </label>
          <label>
            <input type="radio" value="company_rep" {...register('role')} /> Registering a company that offers internships
          </label>
          {formState.errors.role && <p className="field__error">{formState.errors.role.message}</p>}
        </fieldset>

        <Field label="Full name" error={formState.errors.fullName?.message}>
          {(a11y) => <input autoComplete="name" {...a11y} {...register('fullName')} />}
        </Field>
        <Field label="Email" error={formState.errors.email?.message}>
          {(a11y) => <input type="email" autoComplete="email" {...a11y} {...register('email')} />}
        </Field>
        <Field
          label="Password"
          error={formState.errors.password?.message}
          hint="At least 8 characters, with a number and a special character."
        >
          {(a11y) => <input type="password" autoComplete="new-password" {...a11y} {...register('password')} />}
        </Field>
        <Field
          label={role === 'company_rep' ? 'Company contact phone' : 'Phone number'}
          error={formState.errors.phone?.message}
          hint="With the country code, e.g. +233241234567."
        >
          {(a11y) => <input type="tel" autoComplete="tel" placeholder="+233241234567" {...a11y} {...register('phone')} />}
        </Field>

        <Button type="submit" busy={formState.isSubmitting}>
          Create account
        </Button>
      </form>

      <div className="divider">or</div>
      <GoogleButton intent={role}>Sign up with Google</GoogleButton>

      <p className="muted">
        By creating an account you agree to how we handle your data, described in the <Link to="/privacy">privacy notice</Link>.
      </p>
      <p className="muted">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </main>
  );
}
