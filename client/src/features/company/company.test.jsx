import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { makeAuth, renderApp } from '../../test/render';
import { CompanyDashboard } from './CompanyDashboard';
import { PostingFormPage } from './PostingFormPage';
import { PostingsPage } from './PostingsPage';
import { ApplicantsPage } from './ApplicantsPage';
import { ApplicantPage } from './ApplicantPage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const rep = makeAuth({ user: { id: 20, email: 'rep@acme.com.gh', role: 'company_rep', status: 'active', phoneE164: '+233241234567' } });
const apiFailure = (status, code, message, fields) => Object.assign(new Error(message), { response: { status, data: { error: { code, message, fields } } } });
const company = (overrides) => ({ id: 5, name: 'Acme Ltd', regNumber: 'PVT-1', contactPhone: '+233241234567', status: 'verified', ...overrides });
const posting = (overrides) => ({
  id: 9,
  title: 'Data Analyst Intern',
  description: 'Work with data.',
  location: 'Accra',
  domain: 'Data',
  durationWeeks: 12,
  stipend: 15000,
  stipendCurrency: 'GHS',
  deadline: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  status: 'draft',
  skills: ['SQL'],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('CompanyDashboard (US-04)', () => {
  it('offers registration when there is no company yet, and shows it pending afterwards', async () => {
    api.get.mockResolvedValue({ status: 404, data: {} });
    api.post.mockResolvedValue({ data: { company: company({ status: 'pending_verification' }) } });
    renderApp(<CompanyDashboard />, { auth: rep });

    await userEvent.type(await screen.findByLabelText('Company name'), 'Acme Ltd');
    await userEvent.type(screen.getByLabelText('Registration number'), 'PVT-1');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));

    // The contact phone is pre-filled with the rep's own number.
    expect(api.post).toHaveBeenCalledWith('/companies', { name: 'Acme Ltd', regNumber: 'PVT-1', contactPhone: '+233241234567', website: null });
    expect(await screen.findByText(/awaiting admin verification/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New posting' })).not.toBeInTheDocument();
  });

  it('shows a taken registration number on its field', async () => {
    api.get.mockResolvedValue({ status: 404, data: {} });
    api.post.mockRejectedValue(apiFailure(409, 'REG_NUMBER_TAKEN', 'A company with this registration number is already registered', { regNumber: 'Already registered' }));
    renderApp(<CompanyDashboard />, { auth: rep });

    await userEvent.type(await screen.findByLabelText('Company name'), 'Acme Ltd');
    await userEvent.type(screen.getByLabelText('Registration number'), 'PVT-1');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));

    expect(await screen.findByText('Already registered')).toBeInTheDocument();
  });

  it('lets a verified company start a posting', async () => {
    api.get.mockImplementation(async (url) =>
      url === '/companies/me' ? { status: 200, data: { company: company() } } : { data: { items: [], total: 0, page: 1, limit: 5 } },
    );
    renderApp(<CompanyDashboard />, { auth: rep });

    expect(await screen.findByRole('link', { name: 'New posting' })).toHaveAttribute('href', '/company/postings/new');
  });
});

describe('PostingFormPage (US-05)', () => {
  it('requires every field and at least one skill', async () => {
    renderApp(<PostingFormPage />, { auth: rep, route: '/company/postings/new', path: '/company/postings/new' });

    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));

    for (const text of ['Title is required', 'Description is required', 'Location is required', 'Duration is required', 'List at least one required skill', 'Application deadline is required']) {
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
    expect(api.post).not.toHaveBeenCalled();
  });

  it('saves a draft with numbers, an upper-case currency and an end-of-day deadline', async () => {
    api.post.mockResolvedValue({ data: { posting: posting() } });
    renderApp(<PostingFormPage />, { auth: rep, route: '/company/postings/new', path: '/company/postings/new' });

    const day = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await userEvent.type(screen.getByLabelText('Title'), 'Data Analyst Intern');
    await userEvent.type(screen.getByLabelText('Description'), 'Work with data.');
    await userEvent.type(screen.getByLabelText('Required skills'), 'SQL{Enter}');
    await userEvent.type(screen.getByLabelText('Location'), 'Accra');
    await userEvent.type(screen.getByLabelText('Domain'), 'Data');
    await userEvent.type(screen.getByLabelText('Duration (weeks)'), '12');
    await userEvent.type(screen.getByLabelText('Monthly stipend'), '0');
    await userEvent.clear(screen.getByLabelText('Currency'));
    await userEvent.type(screen.getByLabelText('Currency'), 'usd');
    await userEvent.type(screen.getByLabelText('Application deadline'), day);
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/postings');
    expect(body).toMatchObject({ durationWeeks: 12, stipend: 0, stipendCurrency: 'USD', skills: ['SQL'] });
    expect(new Date(body.deadline).getHours()).toBe(23);
    expect(await screen.findByTestId('location')).toHaveTextContent('/company/postings?saved=1');
  });

  it('refuses to edit a published posting', async () => {
    api.get.mockResolvedValue({ data: { posting: posting({ status: 'active' }) } });
    renderApp(<PostingFormPage />, { auth: rep, route: '/company/postings/9/edit', path: '/company/postings/:id/edit' });

    expect(await screen.findByText(/Only drafts can be edited/)).toBeInTheDocument();
  });
});

describe('PostingsPage (US-05)', () => {
  it('offers Publish for drafts and Close for active postings', async () => {
    api.get.mockResolvedValue({ data: { items: [posting(), posting({ id: 10, title: 'Live one', status: 'active' })], total: 2, page: 1, limit: 20 } });
    api.post.mockResolvedValue({ data: { posting: posting({ status: 'active' }) } });
    renderApp(<PostingsPage />, { auth: rep });

    const [draftRow, liveRow] = (await screen.findAllByRole('row')).slice(1);
    await userEvent.click(within(draftRow).getByRole('button', { name: 'Publish' }));
    expect(api.post).toHaveBeenCalledWith('/postings/9/publish');
    expect(await screen.findByText(/is now live for students/)).toBeInTheDocument();

    expect(within(liveRow).queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    await userEvent.click(within(liveRow).getByRole('button', { name: 'Close' }));
    expect(api.post).toHaveBeenCalledWith('/postings/10/close');
  });

  it('shows the reason when publishing is refused', async () => {
    api.get.mockResolvedValue({ data: { items: [posting()], total: 1, page: 1, limit: 20 } });
    api.post.mockRejectedValue(apiFailure(409, 'DEADLINE_PASSED', 'The application deadline has passed. Set a later deadline before publishing'));
    renderApp(<PostingsPage />, { auth: rep });

    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/deadline has passed/)).toBeInTheDocument();
  });
});

describe('ApplicantsPage (US-06)', () => {
  it('sends the filters and lists applicants with their profile summary', async () => {
    api.get.mockImplementation(async (url) =>
      url === '/postings/9'
        ? { data: { posting: posting({ status: 'active' }) } }
        : {
            data: {
              items: [{ id: 30, status: 'applied', createdAt: '2026-10-06T09:00:00Z', student: { fullName: 'Ada Lovelace', email: 'ada@x.co', university: 'UG', department: 'CS', gpa: 3.6, skills: ['SQL', 'Excel'], hasResume: true } }],
              total: 1,
              page: 1,
              limit: 20,
            },
          },
    );
    renderApp(<ApplicantsPage />, { auth: rep, route: '/company/postings/9/applications?skills=SQL&skills=Excel&minGpa=3', path: '/company/postings/:id/applications' });

    expect(await screen.findByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/company/postings/9/applications/30');
    expect(api.get).toHaveBeenCalledWith('/postings/9/applications', {
      params: { skills: 'SQL,Excel', university: undefined, minGpa: '3', status: undefined, page: 1, limit: 20 },
    });
    expect(screen.getByText('1 applicant match')).toBeInTheDocument();
  });
});

describe('ApplicantPage (US-06, US-07)', () => {
  const application = (overrides) => ({
    id: 30,
    status: 'applied',
    coverLetter: 'Hello',
    posting: { id: 9, title: 'Data Analyst Intern' },
    student: { fullName: 'Ada Lovelace', email: 'ada@x.co', university: 'UG', department: 'CS', gpa: 3.6, skills: ['SQL'], hasResume: false },
    history: [{ from: null, to: 'applied', at: '2026-10-06T09:00:00Z', note: null }],
    allowedActions: ['shortlisted', 'interviewed', 'rejected'],
    ...overrides,
  });
  const open = () => renderApp(<ApplicantPage />, { auth: rep, route: '/company/postings/9/applications/30', path: '/company/postings/:postingId/applications/:id' });

  it('offers exactly the allowed moves and sends the note', async () => {
    api.get.mockResolvedValue({ data: { application: application() } });
    api.patch.mockResolvedValue({ data: { application: application({ status: 'shortlisted' }) } });
    open();

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.getByRole('button', { name: 'Shortlist' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Note to include (optional)'), 'Strong SQL');
    await userEvent.click(screen.getByRole('button', { name: 'Shortlist' }));

    expect(api.patch).toHaveBeenCalledWith('/applications/30/status', { status: 'shortlisted', note: 'Strong SQL' });
    expect(await screen.findByText(/The student has been notified/)).toBeInTheDocument();
  });

  it('has nothing to decide once withdrawn', async () => {
    api.get.mockResolvedValue({ data: { application: application({ status: 'withdrawn', allowedActions: [] }) } });
    open();

    expect(await screen.findByText(/nothing more to decide/)).toBeInTheDocument();
  });
});
