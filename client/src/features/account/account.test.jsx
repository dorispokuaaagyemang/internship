import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setSession } from '../../lib/api';
import { makeAuth, renderApp } from '../../test/render';
import { AccountPage } from './AccountPage';
import { PrivacyPage } from './PrivacyPage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setSession: vi.fn(), api: { get: vi.fn(), post: vi.fn() } };
});

const apiFailure = (status, code, message, fields) => Object.assign(new Error(message), { response: { status, data: { error: { code, message, fields } } } });
const as = (user) => makeAuth({ user: { id: 7, email: 'ada@example.com', role: 'student', status: 'active', hasPassword: true, googleLinked: false, ...user } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('AccountPage (data protection)', () => {
  it('downloads the export as a JSON file', async () => {
    api.get.mockResolvedValue({ data: new Blob(['{}'], { type: 'application/json' }) });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderApp(<AccountPage />, { auth: as() });

    await userEvent.click(screen.getByRole('button', { name: 'Download my data' }));

    expect(api.get).toHaveBeenCalledWith('/account/export', { responseType: 'blob' });
    expect(await screen.findByText(/downloaded as a JSON file/)).toBeInTheDocument();
  });

  it('deletes a password account after the password and a confirmation, then signs out', async () => {
    api.post.mockResolvedValue({});
    renderApp(<AccountPage />, { auth: as() });

    await userEvent.type(screen.getByLabelText('Your password'), 'secret#123');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('cannot be undone'));
    expect(api.post).toHaveBeenCalledWith('/account/delete', { password: 'secret#123' });
    await waitFor(() => expect(setSession).toHaveBeenCalledWith(null));
    expect(screen.getByTestId('location')).toHaveTextContent('/login?accountDeleted=1');
  });

  it('shows a wrong password on the field and keeps the account', async () => {
    api.post.mockRejectedValue(apiFailure(422, 'VALIDATION_ERROR', 'The password is not correct', { password: 'Incorrect password' }));
    renderApp(<AccountPage />, { auth: as() });

    await userEvent.type(screen.getByLabelText('Your password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('asks a Google-only account to type its email instead', async () => {
    api.post.mockResolvedValue({});
    renderApp(<AccountPage />, { auth: as({ hasPassword: false, googleLinked: true }) });

    expect(screen.getByText(/Google sign-in linked/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Type your email address/), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(api.post).toHaveBeenCalledWith('/account/delete', { confirmEmail: 'ada@example.com' });
  });

  it('does not offer deletion to an admin', () => {
    renderApp(<AccountPage />, { auth: as({ role: 'admin' }) });
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask another admin/)).toBeInTheDocument();
  });
});

describe('PrivacyPage', () => {
  it('states the retention periods and contact from the server', async () => {
    api.get.mockResolvedValue({
      data: {
        controller: 'Example Internships Ltd',
        contactEmail: 'privacy@example.com',
        backupRetentionDays: 28,
        retention: { inactiveAccountDays: 365, warningDaysBefore: 30, inactiveResumeDays: 182, auditLogDays: 365, unverifiedAccountDays: 30 },
      },
    });
    renderApp(<PrivacyPage />, { auth: makeAuth({ status: 'signedOut', user: null }) });

    expect(await screen.findByText(/Accounts not used for 12 months are deleted/)).toBeInTheDocument();
    expect(screen.getByText(/resume is deleted after 6 months/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'privacy@example.com' })[0]).toHaveAttribute('href', 'mailto:privacy@example.com');
    expect(screen.getByText(/Example Internships Ltd is responsible/)).toBeInTheDocument();
    expect(screen.getByText(/Backups are kept for up to 4 weeks/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Legal basis' })).toBeInTheDocument();
  });
});
