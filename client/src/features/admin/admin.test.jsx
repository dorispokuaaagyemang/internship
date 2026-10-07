import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { makeAuth, renderApp } from '../../test/render';
import { CompaniesPage } from './CompaniesPage';
import { OverviewPage } from './OverviewPage';
import { UsersPage } from './UsersPage';
import { AuditPage } from './AuditPage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const admin = makeAuth({ user: { id: 1, email: 'admin@example.com', role: 'admin', status: 'active' } });
const apiFailure = (status, code, message) => Object.assign(new Error(message), { response: { status, data: { error: { code, message } } } });
const pending = {
  id: 5,
  name: 'Acme Ltd',
  regNumber: 'PVT-1',
  contactPhone: '+233241234567',
  website: 'https://acme.com.gh',
  status: 'pending_verification',
  createdAt: '2026-10-01T08:00:00Z',
  verifiedAt: null,
  reps: [{ id: 7, email: 'rep@acme.com.gh', phone: '+233241234567' }],
};

function answerCompanies(companies) {
  api.get.mockImplementation(async () => ({ data: { items: companies, total: companies.length, page: 1, limit: 20 } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'prompt').mockReturnValue('Fake listings reported');
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('CompaniesPage (US-04, US-12)', () => {
  it('lists companies awaiting verification by default, with their representatives', async () => {
    answerCompanies([pending]);
    renderApp(<CompaniesPage />, { auth: admin });

    expect(await screen.findByText('Acme Ltd')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'rep@acme.com.gh' })).toHaveAttribute('href', 'mailto:rep@acme.com.gh');
    expect(api.get).toHaveBeenCalledWith('/admin/companies', { params: { status: 'pending_verification', page: 1, limit: 20 } });
    expect(screen.getByRole('tab', { name: 'Awaiting verification' })).toHaveAttribute('aria-selected', 'true');
  });

  it('approves after confirmation and says the reps were notified', async () => {
    answerCompanies([pending]);
    api.post.mockResolvedValue({ data: { company: { ...pending, status: 'verified' } } });
    renderApp(<CompaniesPage />, { auth: admin });

    const row = (await screen.findByText('Acme Ltd')).closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Acme Ltd (PVT-1)'));
    expect(api.post).toHaveBeenCalledWith('/admin/companies/5/approve');
    expect(await screen.findByText(/is verified. Its representatives have been notified/)).toBeInTheDocument();
  });

  it('shows why an approval was refused', async () => {
    answerCompanies([pending]);
    api.post.mockRejectedValue(apiFailure(409, 'COMPANY_NOT_PENDING', 'Only a company awaiting verification can be approved (this one is verified)'));
    renderApp(<CompaniesPage />, { auth: admin });

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/this one is verified/)).toBeInTheDocument();
  });

  it('US-12: suspends with a reason, and reinstates a suspended company', async () => {
    answerCompanies([{ ...pending, status: 'verified', verifiedAt: '2026-10-02T08:00:00Z' }]);
    api.post.mockResolvedValue({ data: { company: {} } });
    renderApp(<CompaniesPage />, { auth: admin, route: '/?status=verified' });

    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    expect(api.post).toHaveBeenCalledWith('/admin/companies/5/suspend', { reason: 'Fake listings reported' });
    expect(await screen.findByText(/is suspended and its open postings are closed/)).toBeInTheDocument();
  });

  it('does nothing when the admin cancels the reason prompt', async () => {
    answerCompanies([{ ...pending, status: 'verified' }]);
    window.prompt.mockReturnValue(null);
    renderApp(<CompaniesPage />, { auth: admin, route: '/?status=verified' });

    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('offers Reinstate for a suspended company', async () => {
    answerCompanies([{ ...pending, status: 'suspended' }]);
    api.post.mockResolvedValue({ data: { company: {} } });
    renderApp(<CompaniesPage />, { auth: admin, route: '/?status=suspended' });

    await userEvent.click(await screen.findByRole('button', { name: 'Reinstate' }));
    expect(api.post).toHaveBeenCalledWith('/admin/companies/5/reinstate');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});

describe('OverviewPage (US-12)', () => {
  it('shows active students, companies, postings and applications', async () => {
    api.get.mockImplementation(async (url) =>
      url === '/health'
        ? { data: { status: 'ok', checks: [] } }
        : {
            data: {
              stats: {
                students: { active: 12, total: 15 },
                companies: { verified: 4, pending: 2, suspended: 0, total: 6 },
                postings: { active: 6, total: 7 },
                applications: { applied: 9, accepted: 2, total: 11 },
                users: { pending: 3, suspended: 1, total: 30 },
                generatedAt: '2026-10-07T10:00:00Z',
              },
            },
          },
    );
    renderApp(<OverviewPage />, { auth: admin });

    const stats = await screen.findByRole('list', { name: 'Platform counts' });
    expect(within(stats).getByText('Active students').previousSibling).toHaveTextContent('12');
    expect(within(stats).getByText('2 awaiting verification')).toBeInTheDocument();
    expect(within(stats).getByText('Applications').previousSibling).toHaveTextContent('11');
    expect(screen.getByText(/1 suspended account/)).toBeInTheDocument();
  });
});

describe('UsersPage (US-12)', () => {
  const user = { id: 7, email: 'ada@example.com', role: 'student', status: 'active', name: 'Ada Lovelace', company: null, signInMethod: 'password', lastLoginAt: null, createdAt: '2026-10-01T08:00:00Z' };

  it('searches from the URL and suspends with a reason', async () => {
    api.get.mockResolvedValue({ data: { items: [user, { ...user, id: 1, role: 'admin', name: 'Boss', email: 'boss@x.co' }], total: 2, page: 1, limit: 25 } });
    api.post.mockResolvedValue({ data: { user: { ...user, status: 'suspended' } } });
    renderApp(<UsersPage />, { auth: admin, route: '/?q=ada&role=student' });

    const row = (await screen.findByText('Ada Lovelace')).closest('tr');
    expect(api.get).toHaveBeenCalledWith('/admin/users', { params: { q: 'ada', role: 'student', status: undefined, page: 1, limit: 25 } });

    await userEvent.click(within(row).getByRole('button', { name: 'Suspend' }));
    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining('They lose access immediately'));
    expect(api.post).toHaveBeenCalledWith('/admin/users/7/suspend', { reason: 'Fake listings reported' });

    const adminRow = screen.getByText('Boss').closest('tr');
    expect(within(adminRow).queryByRole('button')).not.toBeInTheDocument();
  });

  it('deletes with a reason', async () => {
    api.get.mockResolvedValue({ data: { items: [user], total: 1, page: 1, limit: 25 } });
    api.delete.mockResolvedValue({});
    renderApp(<UsersPage />, { auth: admin });

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(api.delete).toHaveBeenCalledWith('/admin/users/7', { data: { reason: 'Fake listings reported' } });
    expect(await screen.findByText(/account is deleted/)).toBeInTheDocument();
  });

  it('refuses a reason that is too short', async () => {
    api.get.mockResolvedValue({ data: { items: [user], total: 1, page: 1, limit: 25 } });
    window.prompt.mockReturnValue('no');
    renderApp(<UsersPage />, { auth: admin });

    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    expect(window.alert).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('AuditPage (US-12)', () => {
  it('filters by action group and whole days, and shows who did what', async () => {
    api.get.mockResolvedValue({
      data: {
        items: [{ id: 1, action: 'admin.user_suspended', actor: { id: 1, email: 'boss@x.co' }, actorRole: 'admin', entityType: 'user', entityId: 7, ip: '1.2.3.4', metadata: { reason: 'Spam' }, createdAt: '2026-10-07T10:00:00Z' }],
        total: 1,
        page: 1,
        limit: 50,
      },
    });
    renderApp(<AuditPage />, { auth: admin, route: '/?action=admin.&from=2026-10-01&to=2026-10-07' });

    expect(await screen.findByText('admin.user_suspended')).toBeInTheDocument();
    expect(screen.getByText('user #7 · reason: “Spam”')).toBeInTheDocument();
    const { params } = api.get.mock.calls[0][1];
    expect(params.action).toBe('admin.');
    expect(new Date(params.from).getHours()).toBe(0);
    expect(new Date(params.to).getHours()).toBe(23);
  });
});
