import { AuditLog } from '../../db/models/index.js';

// Records an auth event or admin action (Module 1, US-12).
// `actor` is the acting user (or null for anonymous events); pass the caller's
// transaction so the entry commits or rolls back with the change it describes.
export function record({ actor, action, entity, ip, metadata }, { transaction } = {}) {
  return AuditLog.create(
    {
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      action,
      entityType: entity?.type ?? null,
      entityId: entity?.id ?? null,
      ip: ip ?? null,
      metadata: metadata ?? null,
    },
    { transaction },
  );
}
