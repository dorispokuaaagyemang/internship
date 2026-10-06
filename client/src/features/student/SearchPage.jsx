import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui';
import { deadlineText, money } from '../../lib/format';
import { useSearchPostings } from './api';

const PAGE_SIZE = 10;

// US-03: keyword, location and domain. The search lives in the URL, so it survives a reload
// and can be shared. Open to everyone; applying needs a verified student account.
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const location = params.get('location') ?? '';
  const domain = params.get('domain') ?? '';
  const page = Number(params.get('page')) || 1;

  const query = { q: q || undefined, location: location || undefined, domain: domain || undefined, page, limit: PAGE_SIZE };
  const { data, isPending, isError, isFetching } = useSearchPostings(query);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['q', 'location', 'domain']) {
      const value = String(form.get(key) ?? '').trim();
      if (value) next.set(key, value);
    }
    setParams(next);
  }

  const goTo = (n) => {
    const next = new URLSearchParams(params);
    next.set('page', String(n));
    setParams(next);
  };

  return (
    <main className="page">
      <h1>Find internships</h1>
      <form className="search" role="search" onSubmit={onSubmit} key={params.toString()}>
        <label className="search__q">
          <span className="sr-only">Keywords</span>
          <input name="q" type="search" placeholder="Keywords, e.g. data analyst" defaultValue={q} />
        </label>
        <label>
          <span className="sr-only">Location</span>
          <input name="location" placeholder="Location" defaultValue={location} />
        </label>
        <label>
          <span className="sr-only">Domain</span>
          <input name="domain" placeholder="Domain, e.g. Data" defaultValue={domain} />
        </label>
        <Button type="submit">Search</Button>
      </form>

      <div aria-live="polite" className="muted results-count">
        {data && `${data.total} ${data.total === 1 ? 'internship' : 'internships'} open${isFetching ? ' · updating…' : ''}`}
      </div>

      {isPending && <p className="muted">Searching…</p>}
      {isError && <p className="alert alert--error">Search is unavailable right now. Please try again.</p>}
      {data && data.items.length === 0 && (
        <p className="empty">No open internships match. Try fewer or broader words.</p>
      )}

      <ul className="cards">
        {data?.items.map((p) => (
          <li key={p.id} className="card posting-card">
            <h2>
              <Link to={`/internships/${p.id}`}>{p.title}</Link>
            </h2>
            <p className="muted">
              {p.company?.name} · {p.location} · {p.domain}
            </p>
            <p className="posting-card__facts">
              <span>{money(p.stipend, p.stipendCurrency)}{p.stipend > 0 && ' / month'}</span>
              <span>{p.durationWeeks} weeks</span>
              <span>{deadlineText(p.deadline)}</span>
            </p>
            {p.skills.length > 0 && (
              <ul className="tags__list" aria-label="Required skills">
                {p.skills.map((s) => (
                  <li key={s} className="tag tag--static">
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

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
