import { DataTypes, Model } from 'sequelize';

export const POSTING_STATUSES = ['draft', 'active', 'closed'];

export class Posting extends Model {}

export function initPosting(sequelize) {
  Posting.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      companyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      title: { type: DataTypes.STRING(150), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      location: { type: DataTypes.STRING(100), allowNull: false },
      domain: { type: DataTypes.STRING(80), allowNull: false },
      durationWeeks: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
      // DECIMAL comes back from mysql2 as a string; expose it as a number.
      stipend: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        get() {
          const value = this.getDataValue('stipend');
          return value === null || value === undefined ? value : Number(value);
        },
      },
      stipendCurrency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'KES' },
      deadline: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.ENUM(...POSTING_STATUSES), allowNull: false, defaultValue: 'draft' },
      publishedAt: { type: DataTypes.DATE, allowNull: true },
      closedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'Posting', tableName: 'postings' },
  );
  return Posting;
}
