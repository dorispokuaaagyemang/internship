import { DataTypes, Model } from 'sequelize';

export class RefreshToken extends Model {}

export function initRefreshToken(sequelize) {
  RefreshToken.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'RefreshToken', tableName: 'refresh_tokens' },
  );
  return RefreshToken;
}
