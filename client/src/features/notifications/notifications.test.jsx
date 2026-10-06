import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { renderApp } from '../../test/render';
import { NotificationBell } from './NotificationBell';
import { describeNotification, queriesToRefresh } from './describe';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const statusChanged = {
  id: 1,
  type: 'application.status_changed',
  payload: { applicationId: 30, postingId: 9, postingTitle: 'Data Analyst Intern', companyName: 'Acme Ltd', from: 'applied', to: 'shortlisted' },
  readAt: null,
  createdAt: '2026-10-06T10:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('describeNotification', () => {
  it('words each event and links to the right page', () => {
    expect(describeNotification(statusChanged)).toEqual({
      text: 'Acme Ltd moved your application for Data Analyst Intern to Shortlisted.',
      to: '/applications/30',
    });
    expect(describeNotification({ type: 'application.received', payload: { postingId: 9, applicationId: 30, postingTitle: 'X' } }).to).toBe(
      '/company/postings/9/applications/30',
    );
    expect(describeNotification({ type: 'something.new', payload: {} })).toEqual({ text: 'something.new', to: null });
  });

  it('US-07: marks the application lists stale so open pages update', () => {
    expect(queriesToRefresh(statusChanged)).toEqual([['notifications'], ['applications']]);
    expect(queriesToRefresh({ type: 'company.approved' })).toEqual([['notifications'], ['company']]);
  });
});

describe('NotificationBell', () => {
  it('shows the unread count, lists the latest, and opens one (marking it read)', async () => {
    api.get.mockResolvedValue({ data: { items: [statusChanged], unreadCount: 3, total: 1, page: 1, limit: 5 } });
    api.patch.mockResolvedValue({ data: {} });
    renderApp(<NotificationBell />);

    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    await userEvent.click(bell);
    await userEvent.click(screen.getByRole('menuitem', { name: /moved your application/ }));

    expect(api.patch).toHaveBeenCalledWith('/notifications/1/read');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/applications/30'));
  });

  it('says when there is nothing yet', async () => {
    api.get.mockResolvedValue({ data: { items: [], unreadCount: 0, total: 0, page: 1, limit: 5 } });
    renderApp(<NotificationBell />);

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });
});
