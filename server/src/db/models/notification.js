import { DataTypes, Model } from 'sequelize';

export class Notification extends Model {}

export function initNotification(sequelize) {
  Notification.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      // e.g. application.status_changed; the client picks the wording and link from it.
      type: { type: DataTypes.STRING(50), allowNull: false },
      payload: { type: DataTypes.JSON, allowNull: false },
      readAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'Notification', tableName: 'notifications', updatedAt: false },
  );
  return Notification;
}
