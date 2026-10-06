import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { applyServerErrors } from '../../lib/forms';
import { date } from '../../lib/format';
import { Alert, Button, Card, Field, PageLoading, StatusBadge } from '../../components/ui';
import { useAuth } from '../auth/auth-context';
import { phone } from '../auth/schemas';
import { useMyCompany, useMyPostings, useRegisterCompany } from './api';

// Mirrors server/src/modules/companies/validators.js (US-04).
const companySchema = z.object({
  name: z.string().trim().min(2, 'Company name is required').max(150),
  regNumber: z
    .string()
    .trim()
    .min(1, 'Registration number is required')
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]{1,49}$/, 'Use letters, digits, spaces, dots, dashes or slashes (2-50 characters)'),
  contactPhone: phone,
  website: z.union([z.literal(''), z.string().trim().url('Enter a full web address, e.g. https://example.com')]),
});

// US-04: the company starts Pending Verification; an admin approves it.
function RegisterCompany() {
  const { user } = useAuth();
  const registerCompany = useRegisterCompany();
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(companySchema),
    defaultValues: { name: '', regNumber: '', contactPhone: user?.phoneE164 ?? '', website: '' },
  });
  const { register, handleSubmit, formState } = form;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await registerCompany.mutateAsync({ ...values, contactPhone: values.contactPhone.replace(/[\s-]/g, ''), website: values.website || null });
    } catch (err) {
      setError(applyServerErrors(err, form.setError, ['name', 'regNumber', 'contactPhone', 'website']).message);
    }
  });

  return (
    <Card title="Register your company">
      <p className="muted">An admin checks every company before it can post internships.</p>
      <Alert>{error}</Alert>
      <form onSubmit={onSubmit} noValidate className="stack">
        <Field label="Company name" error={formState.errors.name?.message}>
          {(a11y) => <input autoComplete="organization" {...a11y} {...register('name')} />}
        </Field>
        <Field label="Registration number" error={formState.errors.regNumber?.message} hint="As issued by the business registry, e.g. PVT-2024/123">
          {(a11y) => <input {...a11y} {...register('regNumber')} />}
        </Field>
        <Field label="Contact phone" error={formState.errors.contactPhone?.message} hint="With the country code, e.g. +254712345678.">
          {(a11y) => <input type="tel" autoComplete="tel" {...a11y} {...register('contactPhone')} />}
        </Field>
        <Field label="Website (optional)" error={formState.errors.website?.message}>
          {(a11y) => <input type="url" placeholder="https://" {...a11y} {...register('website')} />}
        </Field>
        <div>
          <Button type="submit" busy={formState.isSubmitting}>
            Submit for verification
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PostingsOverview() {
  const { data } = useMyPostings({ page: 1, limit: 5 });
  return (
    <Card title="Recent postings" actions={<Link to="/company/postings">All postings</Link>}>
      {data?.items.length === 0 && <p className="muted">No postings yet.</p>}
      {data?.items.length > 0 && (
        <ul className="list list--plain">
          {data.items.map((p) => (
            <li key={p.id} className="list__item">
              <div>
                {p.status === 'draft' ? <Link to={`/company/postings/${p.id}/edit`}>{p.title}</Link> : <Link to={`/company/postings/${p.id}/applications`}>{p.title}</Link>}
                <span className="muted"> · deadline {date(p.deadline)}</span>
              </div>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CompanyDashboard() {
  const { data: company, isPending, isError } = useMyCompany();
  if (isPending) return <PageLoading />;

  return (
    <main className="page">
      <h1>{company ? company.name : 'Company'}</h1>
      {isError && <Alert>Could not load your company.</Alert>}
      {!isError && !company && <RegisterCompany />}

      {company && (
        <>
          <p className="muted">
            Registration {company.regNumber} · contact {company.contactPhone} · <StatusBadge status={company.status} />
          </p>
          {company.status === 'pending_verification' && (
            <Alert tone="info">
              Your company is awaiting admin verification. You can create internship postings once it is approved, and we will
              notify you when that happens.
            </Alert>
          )}
          {company.status === 'suspended' && <Alert>Your company is suspended and cannot post internships.</Alert>}
          {company.status === 'verified' && (
            <div className="inline-actions">
              <Link className="btn btn--primary" to="/company/postings/new">
                New posting
              </Link>
            </div>
          )}
          {company.status !== 'pending_verification' && <PostingsOverview />}
        </>
      )}
    </main>
  );
}
