import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { makeAuth, renderApp } from '../../test/render';
import { AdminDashboard } from './AdminDashboard';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const admin = makeAuth({ user: { id: 1, email: 'admin@example.com', role: 'admin', status: 'active' } });
const apiFailure = (status, code, message) => Object.assign(new Error(message), { response: { status, data: { error: { code, message } } } });
const pending = {
  id: 5,
  name: 'Acme Ltd',
  regNumber: 'PVT-1',
  website: 'https://acme.co.ke',
  status: 'pending_verification',
  createdAt: '2026-10-01T08:00:00Z',
  verifiedAt: null,
  reps: [{ id: 7, email: 'rep@acme.co.ke', phone: '+254712345678' }],
};

// The health panel calls /health too; answer it so it renders quietly.
function answer(companies) {
  api.get.mockImplementation(async (url) =>
    url === '/health' ? { data: { status: 'ok', checks: [] } } : { data: { items: companies, total: companies.length, page: 1, limit: 20 } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('AdminDashboard (US-04, US-12)', () => {
  it('lists companies awaiting verification by default, with their representatives', async () => {
    answer([pending]);
    renderApp(<AdminDashboard />, { auth: admin });

    expect(await screen.findByText('Acme Ltd')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'rep@acme.co.ke' })).toHaveAttribute('href', 'mailto:rep@acme.co.ke');
    expect(api.get).toHaveBeenCalledWith('/admin/companies', { params: { status: 'pending_verification', page: 1, limit: 20 } });
    expect(screen.getByRole('tab', { name: 'Awaiting verification' })).toHaveAttribute('aria-selected', 'true');
  });

  it('approves after confirmation and says the reps were notified', async () => {
    answer([pending]);
    api.post.mockResolvedValue({ data: { company: { ...pending, status: 'verified' } } });
    renderApp(<AdminDashboard />, { auth: admin });

    const row = (await screen.findByText('Acme Ltd')).closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Acme Ltd (PVT-1)'));
    expect(api.post).toHaveBeenCalledWith('/admin/companies/5/approve');
    expect(await screen.findByText(/is verified. Its representatives have been notified/)).toBeInTheDocument();
  });

  it('does nothing when the admin cancels', async () => {
    answer([pending]);
    window.confirm.mockReturnValue(false);
    renderApp(<AdminDashboard />, { auth: admin });

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows why an approval was refused', async () => {
    answer([pending]);
    api.post.mockRejectedValue(apiFailure(409, 'COMPANY_NOT_PENDING', 'Only a company awaiting verification can be approved (this one is verified)'));
    renderApp(<AdminDashboard />, { auth: admin });

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/this one is verified/)).toBeInTheDocument();
  });

  it('switches status tabs, and only pending companies can be approved', async () => {
    answer([]);
    renderApp(<AdminDashboard />, { auth: admin });
    expect(await screen.findByText(/All caught up/)).toBeInTheDocument();

    answer([{ ...pending, status: 'verified', verifiedAt: '2026-10-02T08:00:00Z' }]);
    await userEvent.click(screen.getByRole('tab', { name: 'Verified' }));

    expect(await screen.findByText('Acme Ltd')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/admin/companies', expect.objectContaining({ params: expect.objectContaining({ status: 'verified' }) }));
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
