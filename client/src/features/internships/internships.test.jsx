import { Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setSession } from '../../lib/api';
import { makeAuth, renderApp } from '../../test/render';
import { InternshipPage } from './InternshipPage';
import { StaffPage } from './StaffPage';
import { AcceptInvitePage } from '../auth/AcceptInvitePage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setSession: vi.fn(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const apiFailure = (status, code, message, fields) => Object.assign(new Error(message), { response: { status, data: { error: { code, message, fields } } } });
const as = (role, id) => makeAuth({ user: { id, email: `${role}@x.co`, role, status: 'active' } });

const internship = (overrides = {}) => ({
  id: 40,
  status: 'ongoing',
  startDate: '2026-08-03',
  endDate: '2026-09-25',
  completedAt: null,
  certificate: null,
  posting: { id: 9, title: 'Data Analyst Intern', location: 'Accra' },
  company: { id: 5, name: 'Acme Ltd' },
  student: { id: 7, email: 'ada@x.co', fullName: 'Ada Lovelace', university: 'UG', department: 'CS', gpa: 3.6, skills: ['SQL'], hasResume: false },
  supervisor: { id: 50, email: 'grace@acme.co', fullName: 'Grace Hopper' },
  viewerRole: 'supervisor',
  ...overrides,
});
const evaluation = { id: 70, period: 'Week 1', rating: 4, comments: 'Solid start', attendance: 'excellent', isFinal: false, createdAt: '2026-08-10T10:00:00Z', supervisor: { id: 50, fullName: 'Grace Hopper' } };

// The page fetches the internship, its evaluations and (for the company) the staff list.
function serve({ item = internship(), evaluations = [evaluation], staff = [] } = {}) {
  api.get.mockImplementation(async (url) => {
    if (url === '/internships/40') return { data: { internship: item } };
    if (url === '/internships/40/evaluations') return { data: { items: evaluations } };
    if (url === '/companies/me/staff') return { data: { items: staff } };
    throw new Error(`unexpected GET ${url}`);
  });
}
const open = (auth) => renderApp(<InternshipPage backTo="/back" backLabel="Back" />, { route: '/internships/40', path: '/internships/:id', auth });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

describe('InternshipPage as the supervisor (US-10, US-11)', () => {
  it('shows the intern record and evaluations, and offers the form and completion', async () => {
    serve();
    open(as('supervisor', 50));

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('3.6')).toBeInTheDocument();
    expect(await screen.findByText('Solid start')).toBeInTheDocument();
    expect(screen.getByLabelText('Rating 4 out of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add an evaluation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm completion' })).toBeInTheDocument();
  });

  it('requires period, rating, attendance and comments', async () => {
    serve();
    open(as('supervisor', 50));

    await userEvent.click(await screen.findByRole('button', { name: 'Save evaluation' }));

    expect(await screen.findByText('Period is required, e.g. "Week 4"')).toBeInTheDocument();
    expect(screen.getByText('Choose a rating from 1 to 5')).toBeInTheDocument();
    expect(screen.getByText('Choose the attendance')).toBeInTheDocument();
    expect(screen.getByText('Comments are required')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('saves a final evaluation after confirming', async () => {
    serve();
    api.post.mockResolvedValue({ data: { evaluation } });
    open(as('supervisor', 50));

    await userEvent.type(await screen.findByLabelText('Period'), 'Final');
    await userEvent.click(screen.getByLabelText('5'));
    await userEvent.selectOptions(screen.getByLabelText('Attendance'), 'good');
    await userEvent.type(screen.getByLabelText('Comments'), 'Great work');
    await userEvent.click(screen.getByLabelText(/This is the final evaluation/));
    await userEvent.click(screen.getByRole('button', { name: 'Save evaluation' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/internships/40/evaluations', { period: 'Final', rating: 5, attendance: 'good', comments: 'Great work', isFinal: true }),
    );
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('cannot be edited'));
    expect(await screen.findByText(/Evaluation saved/)).toBeInTheDocument();
  });

  it('lists what is missing when completion is refused (US-11)', async () => {
    serve();
    api.post.mockRejectedValue(
      apiFailure(422, 'CERTIFICATE_NOT_READY', "The certificate can't be issued yet", {
        endDate: 'The internship ends on 2026-09-25; it can be completed after that day',
        finalEvaluation: 'Submit a final evaluation first',
      }),
    );
    open(as('supervisor', 50));

    await userEvent.click(await screen.findByRole('button', { name: 'Confirm completion' }));

    expect(api.post).toHaveBeenCalledWith('/internships/40/complete');
    expect(await screen.findByText('Submit a final evaluation first')).toBeInTheDocument();
    expect(screen.getByText(/can be completed after that day/)).toBeInTheDocument();
  });
});

describe('InternshipPage as the student (US-10, US-11)', () => {
  it('shows evaluations read-only, with no form and no completion', async () => {
    serve({ item: internship({ viewerRole: 'student', student: { id: 7, email: 'ada@x.co', fullName: 'Ada Lovelace', university: 'UG', department: 'CS' } }) });
    open(as('student', 7));

    expect(await screen.findByRole('heading', { name: 'Data Analyst Intern' })).toBeInTheDocument();
    expect(await screen.findByText('Solid start')).toBeInTheDocument();
    expect(screen.getByText(/They are read-only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save evaluation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm completion' })).not.toBeInTheDocument();
  });

  it('downloads the certificate once issued', async () => {
    serve({ item: internship({ viewerRole: 'student', status: 'completed', completedAt: '2026-09-26T10:00:00Z', certificate: { serialNo: 'CERT-2026-000040-ABC123', issuedAt: '2026-09-26T10:01:00Z' } }) });
    api.get.mockImplementationOnce(async () => ({ data: { internship: internship({ viewerRole: 'student', status: 'completed', certificate: { serialNo: 'CERT-2026-000040-ABC123', issuedAt: '2026-09-26T10:01:00Z' } }) } }));
    open(as('student', 7));

    const button = await screen.findByRole('button', { name: 'Download certificate (PDF)' });
    expect(screen.getByText(/CERT-2026-000040-ABC123/)).toBeInTheDocument();

    api.get.mockResolvedValueOnce({ data: { url: 'https://storage.example/cert' } });
    await userEvent.click(button);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://storage.example/cert', '_blank', 'noopener'));
  });

  it('says the certificate is being prepared while the worker makes it', async () => {
    serve({ item: internship({ viewerRole: 'student', status: 'completed', completedAt: '2026-09-26T10:00:00Z' }) });
    open(as('student', 7));

    expect(await screen.findByText(/certificate is being prepared/)).toBeInTheDocument();
  });
});

describe('InternshipPage as the company (US-09)', () => {
  it('assigns a supervisor from the staff list, showing each one\'s load', async () => {
    serve({
      item: internship({ viewerRole: 'company', supervisor: null }),
      staff: [
        { id: 20, email: 'rep@acme.co', fullName: null, memberRole: 'rep', status: 'active', activeInterns: 0 },
        { id: 50, email: 'grace@acme.co', fullName: 'Grace Hopper', memberRole: 'supervisor', status: 'active', activeInterns: 2 },
        { id: 51, email: 'new@acme.co', fullName: 'New Person', memberRole: 'supervisor', status: 'invited', activeInterns: 0 },
      ],
    });
    api.post.mockResolvedValue({ data: { internship: internship({ viewerRole: 'company' }) } });
    open(as('company_rep', 20));

    const select = await screen.findByRole('combobox');
    expect(await screen.findByRole('option', { name: 'Grace Hopper · 2 interns' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'New Person (invited) · 0 interns' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /rep@acme/ })).not.toBeInTheDocument();

    await userEvent.selectOptions(select, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(api.post).toHaveBeenCalledWith('/internships/40/supervisor', { supervisorId: 50 });
    expect(await screen.findByText(/Supervisor assigned/)).toBeInTheDocument();
  });

  it('points to the staff page when there are no supervisors yet', async () => {
    serve({ item: internship({ viewerRole: 'company', supervisor: null }), staff: [{ id: 20, memberRole: 'rep', status: 'active', email: 'r@x' }] });
    open(as('company_rep', 20));

    expect(await screen.findByRole('link', { name: 'Add one' })).toHaveAttribute('href', '/company/staff');
  });
});

describe('StaffPage (US-09)', () => {
  it('invites a supervisor and offers to resend a pending invitation', async () => {
    api.get.mockResolvedValue({ data: { items: [{ id: 51, email: 'new@acme.co', fullName: 'New Person', memberRole: 'supervisor', status: 'invited', activeInterns: 0 }] } });
    api.post.mockImplementation(async (url) =>
      url === '/companies/me/staff' ? { data: { member: { id: 52, email: 'grace@acme.co' } } } : { data: { message: 'Invitation sent' } },
    );
    renderApp(<StaffPage />, { auth: as('company_rep', 20) });

    await userEvent.type(screen.getByLabelText('Full name'), 'Grace Hopper');
    await userEvent.type(screen.getByLabelText('Work email'), 'grace@acme.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(api.post).toHaveBeenCalledWith('/companies/me/staff', { fullName: 'Grace Hopper', email: 'grace@acme.co' });
    expect(await screen.findByText(/Invitation sent to grace@acme.co/)).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Resend invitation' }));
    expect(api.post).toHaveBeenCalledWith('/companies/me/staff/51/invite');
  });
});

describe('AcceptInvitePage (US-09)', () => {
  const page = (auth = makeAuth({ status: 'signedOut', user: null })) =>
    renderApp(
      [<Route key="i" path="/accept-invite/:token" element={<AcceptInvitePage />} />],
      { route: '/accept-invite/tok123', auth },
    );

  it('shows who invited them, checks the passwords match, then signs them in', async () => {
    api.get.mockResolvedValue({ data: { invite: { email: 'grace@acme.co', fullName: 'Grace Hopper', companyName: 'Acme Ltd' } } });
    const session = { accessToken: 't', user: { id: 50, role: 'supervisor', status: 'active' } };
    api.post.mockResolvedValue({ data: session });
    page();

    expect(await screen.findByRole('heading', { name: 'Welcome, Grace Hopper' })).toBeInTheDocument();
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Password'), 'secret#123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'secret#124');
    await userEvent.click(screen.getByRole('button', { name: 'Set password and continue' }));
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), 'secret#123');
    await userEvent.click(screen.getByRole('button', { name: 'Set password and continue' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/invite/accept', { token: 'tok123', password: 'secret#123' }));
    expect(setSession).toHaveBeenCalledWith(session);
  });

  it('explains an expired or used link', async () => {
    api.get.mockRejectedValue(apiFailure(410, 'INVITE_EXPIRED', 'This invitation has expired. Ask your company to send a new one.'));
    page();

    expect(await screen.findByText(/This invitation has expired/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
