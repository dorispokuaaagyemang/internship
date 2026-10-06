import { DataTypes, Model } from 'sequelize';

// US-07: the closed set of application statuses.
export const APPLICATION_STATUSES = ['applied', 'shortlisted', 'interviewed', 'accepted', 'rejected', 'withdrawn'];

export class Application extends Model {}
export class ApplicationStatusHistory extends Model {}

export function initApplication(sequelize) {
  Application.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      postingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      studentId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: { type: DataTypes.ENUM(...APPLICATION_STATUSES), allowNull: false, defaultValue: 'applied' },
      coverLetter: { type: DataTypes.TEXT, allowNull: true },
    },
    { sequelize, modelName: 'Application', tableName: 'applications' },
  );
  return Application;
}

export function initApplicationStatusHistory(sequelize) {
  ApplicationStatusHistory.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      applicationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      fromStatus: { type: DataTypes.ENUM(...APPLICATION_STATUSES), allowNull: true },
      toStatus: { type: DataTypes.ENUM(...APPLICATION_STATUSES), allowNull: false },
      changedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      sequelize,
      modelName: 'ApplicationStatusHistory',
      tableName: 'application_status_history',
      // Rows are only ever added.
      updatedAt: false,
    },
  );
  return ApplicationStatusHistory;
}
