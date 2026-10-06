import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { date, statusLabel } from '../../lib/format';
import { Button, StatusBadge } from '../../components/ui';
import { TagInput } from '../../components/TagInput';
import { useApplicants, useCompanyPosting } from './api';

const STATUSES = ['applied', 'shortlisted', 'interviewed', 'accepted', 'rejected', 'withdrawn'];
const PAGE_SIZE = 20;

// US-06: a posting's applicants with profile summaries, filtered by skills (all must match),
// university and minimum GPA. Filters live in the URL; new applicants appear live.
export function ApplicantsPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const skills = params.getAll('skills');
  const university = params.get('university') ?? '';
  const minGpa = params.get('minGpa') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page')) || 1;

  const posting = useCompanyPosting(id);
  const query = {
    skills: skills.length ? skills.join(',') : undefined,
    university: university || undefined,
    minGpa: minGpa || undefined,
    status: status || undefined,
    page,
    limit: PAGE_SIZE,
  };
  const { data, isPending, isError, isFetching } = useApplicants(id, query);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  // Draft filters, applied on submit so each keystroke isn't a request.
  const [draft, setDraft] = useState({ skills, university, minGpa, status });

  function apply(e) {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const s of draft.skills) next.append('skills', s);
    for (const key of ['university', 'minGpa', 'status']) if (draft[key]) next.set(key, draft[key]);
    setParams(next);
  }

  function reset() {
    setDraft({ skills: [], university: '', minGpa: '', status: '' });
    setParams(new URLSearchParams());
  }

  const goTo = (n) => {
    const next = new URLSearchParams(params);
    next.set('page', String(n));
    setParams(next);
  };
  const filtered = skills.length || university || minGpa || status;

  return (
    <main className="page">
      <p>
        <Link to="/company/postings">← Postings</Link>
      </p>
      <h1>Applicants{posting.data && <span className="muted">: {posting.data.title}</span>}</h1>

      <form className="card filters" onSubmit={apply} aria-label="Filter applicants">
        <div className="filters__grid">
          <label>
            Skills (all of)
            <TagInput value={draft.skills} max={10} onChange={(v) => setDraft((d) => ({ ...d, skills: v }))} placeholder="e.g. SQL" />
          </label>
          <label>
            University
            <input value={draft.university} onChange={(e) => setDraft((d) => ({ ...d, university: e.target.value }))} placeholder="contains…" />
          </label>
          <label>
            Minimum GPA
            <input inputMode="decimal" value={draft.minGpa} onChange={(e) => setDraft((d) => ({ ...d, minGpa: e.target.value }))} placeholder="e.g. 3.0" />
          </label>
          <label>
            Status
            <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="inline-actions">
          <Button type="submit">Apply filters</Button>
          {filtered && (
            <Button type="button" variant="link" onClick={reset}>
              Clear
            </Button>
          )}
        </div>
      </form>

      <div aria-live="polite" className="muted results-count">
        {data && `${data.total} ${data.total === 1 ? 'applicant' : 'applicants'}${filtered ? ' match' : ''}${isFetching ? ' · updating…' : ''}`}
      </div>
      {isPending && <p className="muted">Loading…</p>}
      {isError && <p className="alert alert--error">Could not load the applicants. Check the filters and try again.</p>}
      {data && data.items.length === 0 && <p className="empty">{filtered ? 'No applicants match these filters.' : 'No applications yet.'}</p>}

      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Applicant</th>
              <th scope="col">University</th>
              <th scope="col">GPA</th>
              <th scope="col">Skills</th>
              <th scope="col">Applied</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/company/postings/${id}/applications/${a.id}`}>{a.student.fullName ?? a.student.email}</Link>
                  {a.student.hasResume && <div className="muted small">Resume attached</div>}
                </td>
                <td>
                  {a.student.university}
                  <div className="muted small">{a.student.department}</div>
                </td>
                <td>{a.student.gpa ?? '—'}</td>
                <td className="small">{a.student.skills.join(', ')}</td>
                <td>{date(a.createdAt)}</td>
                <td>
                  <StatusBadge status={a.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <Button variant="secondary" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => goTo(page + 1)}>
            Next
          </Button>
        </nav>
      )}
    </main>
  );
}
