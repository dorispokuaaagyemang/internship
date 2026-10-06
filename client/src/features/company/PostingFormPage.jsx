import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { applyServerErrors } from '../../lib/forms';
import { Alert, Button, Card, Field, PageLoading } from '../../components/ui';
import { TagInput } from '../../components/TagInput';
import { useCompanyPosting, useCreatePosting, useUpdatePosting } from './api';

const YEAR_MS = 365 * 86_400_000;
// A date input gives "2026-11-30"; the posting stays open until the end of that day, local time.
const endOfDay = (day) => new Date(`${day}T23:59:59`);
const toDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Mirrors server/src/modules/postings/validators.js (US-05).
const text = (label, max) => z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);
const postingSchema = z.object({
  title: text('Title', 150),
  description: text('Description', 10_000),
  location: text('Location', 100),
  domain: text('Domain', 80),
  durationWeeks: z.string().trim().regex(/^\d+$/, 'Duration is required').refine((v) => Number(v) >= 1 && Number(v) <= 104, 'Duration must be between 1 and 104 weeks'),
  stipend: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Stipend is required (0 for unpaid)'),
  stipendCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code, e.g. KES'),
  deadline: z
    .string()
    .min(1, 'Application deadline is required')
    .refine((d) => endOfDay(d) > new Date(), 'The deadline must be in the future')
    .refine((d) => endOfDay(d) - Date.now() <= YEAR_MS, 'The deadline must be within a year'),
  skills: z.array(z.string()).min(1, 'List at least one required skill').max(20, 'List at most 20 skills'),
});
const FIELDS = Object.keys(postingSchema.shape);

const toForm = (p) => ({
  title: p?.title ?? '',
  description: p?.description ?? '',
  location: p?.location ?? '',
  domain: p?.domain ?? '',
  durationWeeks: p ? String(p.durationWeeks) : '',
  stipend: p ? String(p.stipend) : '',
  stipendCurrency: p?.stipendCurrency ?? 'KES',
  deadline: p ? toDay(p.deadline) : '',
  skills: p?.skills ?? [],
});

function PostingForm({ posting }) {
  const navigate = useNavigate();
  const create = useCreatePosting();
  const update = useUpdatePosting();
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(postingSchema), defaultValues: toForm(posting) });
  const { register, handleSubmit, formState, control } = form;
  const e = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const body = {
      ...values,
      durationWeeks: Number(values.durationWeeks),
      stipend: Number(values.stipend),
      stipendCurrency: values.stipendCurrency.toUpperCase(),
      deadline: endOfDay(values.deadline).toISOString(),
    };
    try {
      if (posting) await update.mutateAsync({ id: posting.id, values: body });
      else await create.mutateAsync(body);
      navigate('/company/postings?saved=1');
    } catch (err) {
      setError(applyServerErrors(err, form.setError, FIELDS).message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="stack">
      <Alert>{error}</Alert>
      <Card title="The internship">
        <div className="stack">
          <Field label="Title" error={e.title?.message}>
            {(a11y) => <input placeholder="e.g. Data Analyst Intern" {...a11y} {...register('title')} />}
          </Field>
          <Field label="Description" error={e.description?.message} hint="What the intern will do and learn, and who you are looking for.">
            {(a11y) => <textarea rows={8} {...a11y} {...register('description')} />}
          </Field>
          <Field label="Required skills" error={e.skills?.message} hint="Press Enter or comma after each skill.">
            {(a11y) => (
              <Controller control={control} name="skills" render={({ field }) => <TagInput {...a11y} max={20} value={field.value} onChange={field.onChange} placeholder="e.g. SQL" />} />
            )}
          </Field>
        </div>
      </Card>
      <Card title="Terms">
        <div className="grid-2">
          <Field label="Location" error={e.location?.message}>
            {(a11y) => <input placeholder="e.g. Nairobi" {...a11y} {...register('location')} />}
          </Field>
          <Field label="Domain" error={e.domain?.message}>
            {(a11y) => <input placeholder="e.g. Data" {...a11y} {...register('domain')} />}
          </Field>
          <Field label="Duration (weeks)" error={e.durationWeeks?.message}>
            {(a11y) => <input inputMode="numeric" {...a11y} {...register('durationWeeks')} />}
          </Field>
          <Field label="Monthly stipend" error={e.stipend?.message} hint="0 for unpaid">
            {(a11y) => <input inputMode="decimal" {...a11y} {...register('stipend')} />}
          </Field>
          <Field label="Currency" error={e.stipendCurrency?.message}>
            {(a11y) => <input maxLength={3} className="input--short" {...a11y} {...register('stipendCurrency')} />}
          </Field>
          <Field label="Application deadline" error={e.deadline?.message} hint="Applications close at the end of this day.">
            {(a11y) => <input type="date" {...a11y} {...register('deadline')} />}
          </Field>
        </div>
      </Card>
      <div className="inline-actions">
        <Button type="submit" busy={formState.isSubmitting}>
          {posting ? 'Save draft' : 'Save as draft'}
        </Button>
        <Link to="/company/postings">Cancel</Link>
        <span className="muted">You can publish it from the postings list.</span>
      </div>
    </form>
  );
}

// US-05: create a draft, or edit one (only drafts can change).
export function PostingFormPage() {
  const { id } = useParams();
  const { data: posting, isPending, isError } = useCompanyPosting(id);

  if (id && isPending) return <PageLoading />;
  if (id && (isError || !posting)) {
    return (
      <main className="page">
        <h1>Posting not found</h1>
        <Link to="/company/postings">Back to postings</Link>
      </main>
    );
  }
  if (posting && posting.status !== 'draft') {
    return (
      <main className="page page--medium">
        <h1>{posting.title}</h1>
        <Alert tone="info">This posting is {posting.status}. Only drafts can be edited, so students always see what they applied to.</Alert>
        <Link to="/company/postings">Back to postings</Link>
      </main>
    );
  }

  return (
    <main className="page page--medium">
      <p>
        <Link to="/company/postings">← Postings</Link>
      </p>
      <h1>{posting ? 'Edit draft' : 'New internship posting'}</h1>
      <PostingForm posting={posting} />
    </main>
  );
}
