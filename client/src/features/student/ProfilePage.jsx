import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiError } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { date, fileSize } from '../../lib/format';
import { Alert, Button, Card, Field, PageLoading } from '../../components/ui';
import { useAuth } from '../auth/auth-context';
import { TagInput } from '../../components/TagInput';
import { openResume, useDeleteResume, useProfile, useSaveProfile, useUploadResume } from './api';

// Mirrors server/src/modules/students/validators.js (US-02).
const required = (label, max) => z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);
const profileSchema = z.object({
  fullName: required('Full name', 120),
  university: required('University', 150),
  department: required('Department', 150),
  gpa: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d(\.\d{1,2})?$/.test(v) && Number(v) <= 5), 'GPA must be a number between 0 and 5'),
  bio: z.string().max(2000, 'Keep the bio under 2000 characters'),
  skills: z.array(z.string()).max(30, 'List at most 30 skills'),
});
const FIELDS = ['fullName', 'university', 'department', 'gpa', 'bio', 'skills'];

// A new profile starts with the name given at registration (or by Google).
const toForm = (p, displayName) => ({
  fullName: p?.fullName ?? displayName ?? '',
  university: p?.university ?? '',
  department: p?.department ?? '',
  gpa: p?.gpa != null ? String(p.gpa) : '',
  bio: p?.bio ?? '',
  skills: p?.skills ?? [],
});

function ProfileForm({ profile }) {
  const { user } = useAuth();
  const save = useSaveProfile();
  const [result, setResult] = useState(null);
  const form = useForm({ resolver: zodResolver(profileSchema), defaultValues: toForm(profile, user?.displayName) });
  const { register, handleSubmit, formState, control, reset } = form;

  const onSubmit = handleSubmit(async (values) => {
    setResult(null);
    try {
      const data = await save.mutateAsync({ ...values, gpa: values.gpa === '' ? null : Number(values.gpa) });
      reset(toForm(data.profile));
      setResult({ tone: 'success', text: `Profile saved ${date(data.profile.updatedAt)}.` });
    } catch (err) {
      setResult({ tone: 'error', text: applyServerErrors(err, form.setError, FIELDS).message });
    }
  });

  const e = formState.errors;
  return (
    <Card title="Your details">
      {result && <Alert tone={result.tone}>{result.text}</Alert>}
      <form onSubmit={onSubmit} noValidate className="stack">
        <Field label="Full name" error={e.fullName?.message}>
          {(a11y) => <input autoComplete="name" {...a11y} {...register('fullName')} />}
        </Field>
        <div className="grid-2">
          <Field label="University" error={e.university?.message}>
            {(a11y) => <input {...a11y} {...register('university')} />}
          </Field>
          <Field label="Department" error={e.department?.message}>
            {(a11y) => <input {...a11y} {...register('department')} />}
          </Field>
        </div>
        <Field label="GPA (optional)" error={e.gpa?.message} hint="On a 0–5 scale, e.g. 3.6">
          {(a11y) => <input inputMode="decimal" className="input--short" {...a11y} {...register('gpa')} />}
        </Field>
        <Field label="Skills" error={e.skills?.message} hint="Press Enter or comma after each skill.">
          {(a11y) => (
            <Controller
              control={control}
              name="skills"
              render={({ field }) => <TagInput {...a11y} value={field.value} onChange={field.onChange} placeholder="e.g. SQL" />}
            />
          )}
        </Field>
        <Field label="About you (optional)" error={e.bio?.message}>
          {(a11y) => <textarea {...a11y} {...register('bio')} />}
        </Field>
        <div className="inline-actions">
          <Button type="submit" busy={formState.isSubmitting} disabled={!formState.isDirty}>
            Save profile
          </Button>
          {formState.isDirty && <span className="muted">Unsaved changes</span>}
        </div>
      </form>
    </Card>
  );
}

const RESUME_MAX = 5 * 1024 * 1024;

// US-02: PDF or Word (.docx) under 5 MB. Checked here for a quick answer; the server checks the
// file's real contents.
function ResumeCard({ profile }) {
  const upload = useUploadResume();
  const remove = useDeleteResume();
  const input = useRef(null);
  const [error, setError] = useState(null);
  const resume = profile?.resume;

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    if (!/\.(pdf|docx)$/i.test(file.name)) return setError('Choose a PDF or Word (.docx) file.');
    if (file.size >= RESUME_MAX) return setError('The file must be under 5 MB.');
    try {
      await upload.mutateAsync(file);
    } catch (err) {
      setError(apiError(err).message);
    }
  }

  async function view() {
    try {
      await openResume();
    } catch (err) {
      setError(apiError(err).message);
    }
  }

  return (
    <Card title="Resume">
      <Alert>{error}</Alert>
      {!profile ? (
        <p className="muted">Save your details first, then you can upload a resume.</p>
      ) : resume ? (
        <p>
          <strong>{resume.fileName}</strong> <span className="muted">· {fileSize(resume.size)} · uploaded {date(resume.uploadedAt)}</span>
        </p>
      ) : (
        <p className="muted">No resume yet. Companies see it when you apply.</p>
      )}
      <input ref={input} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={onFile} aria-label="Resume file" />
      <div className="inline-actions">
        <Button type="button" variant={resume ? 'secondary' : 'primary'} disabled={!profile} busy={upload.isPending} onClick={() => input.current?.click()}>
          {resume ? 'Replace' : 'Upload resume'}
        </Button>
        {resume && (
          <>
            <Button type="button" variant="secondary" onClick={view}>
              View
            </Button>
            <Button type="button" variant="link" busy={remove.isPending} onClick={() => window.confirm('Remove your resume?') && remove.mutate()}>
              Remove
            </Button>
          </>
        )}
      </div>
      <p className="field__hint">PDF or Word (.docx), under 5 MB.</p>
    </Card>
  );
}

export function ProfilePage() {
  const { data, isPending, isError } = useProfile();
  const heading = useRef(null);
  useEffect(() => heading.current?.focus(), []);

  if (isPending) return <PageLoading />;
  return (
    <main className="page page--medium">
      <h1 ref={heading} tabIndex={-1}>
        Your profile
      </h1>
      {isError && <Alert>Could not load your profile.</Alert>}
      {data && !data.completeness.complete && (
        <Alert tone="info">Fill in your full name, university and department. You need them to apply for internships.</Alert>
      )}
      {data && (
        <div className="stack">
          <ProfileForm profile={data.profile} />
          <ResumeCard profile={data.profile} />
        </div>
      )}
    </main>
  );
}
