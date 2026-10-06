import { DataTypes, Model } from 'sequelize';
import { AppError } from '../../lib/errors.js';

// US-12: the audit trail is insert-only.
function rejectMutation() {
  throw new AppError(500, 'AUDIT_IMMUTABLE', 'Audit log entries cannot be changed or deleted');
}

export class AuditLog extends Model {}

export function initAuditLog(sequelize) {
  AuditLog.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      actorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      actorRole: { type: DataTypes.STRING(32), allowNull: true },
      action: { type: DataTypes.STRING(64), allowNull: false },
      entityType: { type: DataTypes.STRING(64), allowNull: true },
      entityId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      ip: { type: DataTypes.STRING(45), allowNull: true },
      metadata: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AuditLog',
      tableName: 'audit_logs',
      updatedAt: false,
      hooks: {
        beforeUpdate: rejectMutation,
        beforeBulkUpdate: rejectMutation,
        beforeDestroy: rejectMutation,
        beforeBulkDestroy: rejectMutation,
      },
    },
  );
  return AuditLog;
}
