import { describe, expect, it, vi } from 'vitest';
import { User, AuditLog, RefreshToken } from '../../src/db/models/index.js';
import { record } from '../../src/modules/audit/service.js';

// The models are built on a real Sequelize instance; nothing here opens a connection.

describe('User model (US-00A, US-01)', () => {
  it('maps camelCase attributes to snake_case columns with soft delete', () => {
    expect(User.getAttributes().passwordHash.field).toBe('password_hash');
    expect(User.getAttributes().emailVerifiedAt.field).toBe('email_verified_at');
    expect(User.getAttributes()).not.toHaveProperty('phoneVerifiedAt');
    expect(User.options.paranoid).toBe(true);
  });

  it('defaults new accounts to pending', () => {
    expect(User.build({ email: 'a@b.co', role: 'student' }).status).toBe('pending');
  });

  it('never serializes the password hash or Google id', () => {
    const user = User.build({ email: 'a@b.co', role: 'student', passwordHash: 'x', googleId: 'g' });
    const json = user.toJSON();

    expect(json).not.toHaveProperty('passwordHash');
    expect(json).not.toHaveProperty('googleId');
    expect(json.email).toBe('a@b.co');
  });
});

describe('auth token tables', () => {
  it('refresh tokens belong to a user', () => {
    expect(RefreshToken.associations.user.target).toBe(User);
  });
});

describe('AuditLog model (US-12)', () => {
  it('has no updated_at column', () => {
    expect(AuditLog.getAttributes()).not.toHaveProperty('updatedAt');
  });

  it('rejects updates and deletes before reaching the database', async () => {
    const entry = AuditLog.build({ id: 1, action: 'auth.login' }, { isNewRecord: false });

    await expect(entry.update({ action: 'tampered' })).rejects.toMatchObject({ code: 'AUDIT_IMMUTABLE' });
    await expect(entry.destroy()).rejects.toMatchObject({ code: 'AUDIT_IMMUTABLE' });
    await expect(AuditLog.update({ action: 'x' }, { where: {} })).rejects.toMatchObject({
      code: 'AUDIT_IMMUTABLE',
    });
    await expect(AuditLog.destroy({ where: {} })).rejects.toMatchObject({ code: 'AUDIT_IMMUTABLE' });
  });
});

describe('audit.record', () => {
  it('stores actor id, role, action, entity and ip', async () => {
    const create = vi.spyOn(AuditLog, 'create').mockResolvedValue({});
    const transaction = {};

    await record(
      {
        actor: { id: 7, role: 'admin' },
        action: 'company.approve',
        entity: { type: 'company', id: 3 },
        ip: '10.0.0.1',
      },
      { transaction },
    );

    expect(create).toHaveBeenCalledWith(
      {
        actorId: 7,
        actorRole: 'admin',
        action: 'company.approve',
        entityType: 'company',
        entityId: 3,
        ip: '10.0.0.1',
        metadata: null,
      },
      { transaction },
    );
  });

  it('allows anonymous events', async () => {
    const create = vi.spyOn(AuditLog, 'create').mockResolvedValue({});

    await record({ actor: null, action: 'auth.login_failed', metadata: { email: 'x@y.z' } });

    expect(create.mock.calls.at(-1)[0]).toMatchObject({ actorId: null, actorRole: null });
  });
});
