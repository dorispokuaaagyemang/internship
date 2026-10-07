import { Op } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshToken, EmailVerificationToken, AccountInvite, Notification, Internship } from '../../src/db/models/index.js';
import { emit } from '../../src/lib/events.js';
import { purgeExpired, remindEndedInternships } from '../../src/modules/maintenance/service.js';
import { processMaintenance, SCHEDULES } from '../../src/jobs/processors/maintenance.js';

vi.mock('../../src/db/models/index.js', () => ({
  RefreshToken: { destroy: vi.fn() },
  EmailVerificationToken: { destroy: vi.fn() },
  AccountInvite: { destroy: vi.fn() },
  Notification: { destroy: vi.fn(), count: vi.fn() },
  Internship: { findAll: vi.fn() },
  SupervisorAssignment: {},
  Application: {},
  Posting: {},
  StudentProfile: {},
}));
vi.mock('../../src/lib/events.js', () => ({ emit: vi.fn() }));
vi.mock('../../src/modules/postings/service.js', () => ({ closeExpiredPostings: vi.fn() }));
vi.mock('../../src/modules/internships/service.js', () => ({ issueMissingCertificates: vi.fn() }));

const NOW = new Date('2026-10-07T03:00:00Z');
const DAY = 86_400_000;

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of [RefreshToken, EmailVerificationToken, AccountInvite, Notification]) m.destroy.mockResolvedValue(2);
});

describe('maintenance.cleanup', () => {
  it('removes credentials that stopped working over 30 days ago, and read notifications over 180 days old', async () => {
    await expect(purgeExpired(NOW)).resolves.toEqual({ refreshTokens: 2, emailTokens: 2, invites: 2, notifications: 2 });

    const cutoff = new Date(NOW.getTime() - 30 * DAY);
    expect(RefreshToken.destroy).toHaveBeenCalledWith({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: cutoff } }, { revokedAt: { [Op.lt]: cutoff } }] } });
    expect(EmailVerificationToken.destroy).toHaveBeenCalledWith({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: cutoff } }, { usedAt: { [Op.lt]: cutoff } }] } });
    expect(AccountInvite.destroy).toHaveBeenCalledWith({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: cutoff } }, { usedAt: { [Op.lt]: cutoff } }] } });
    expect(Notification.destroy).toHaveBeenCalledWith({ where: { readAt: { [Op.lt]: new Date(NOW.getTime() - 180 * DAY) } } });
  });

  it('is scheduled daily alongside the reminder', () => {
    expect(SCHEDULES.map((s) => s.name)).toEqual(expect.arrayContaining(['maintenance.cleanup', 'internships.markEnded']));
    expect(SCHEDULES.find((s) => s.name === 'maintenance.cleanup').every).toBe(DAY);
  });
});

describe('internships.markEnded (US-11)', () => {
  const ended = (id) => ({
    id,
    endDate: '2026-09-25',
    activeAssignment: { supervisorUserId: 50 },
    application: { posting: { title: 'Analyst' }, profile: { fullName: 'Ada' } },
  });

  it('reminds the supervisor once per ended internship', async () => {
    Internship.findAll.mockResolvedValue([ended(40), ended(41)]);
    Notification.count.mockImplementation(async ({ where }) => (where.payload.internshipId === 41 ? 1 : 0));

    await expect(remindEndedInternships(NOW)).resolves.toBe(1);
    expect(Internship.findAll.mock.calls[0][0].where).toEqual({ status: 'ongoing', endDate: { [Op.lt]: '2026-10-07' } });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('internship.ended', { internshipId: 40, supervisorId: 50, endDate: '2026-09-25', postingTitle: 'Analyst', studentName: 'Ada' });
  });

  it('runs through the maintenance processor', async () => {
    Internship.findAll.mockResolvedValue([]);
    await expect(processMaintenance({ name: 'internships.markEnded' })).resolves.toEqual({ reminded: 0 });
  });
});
