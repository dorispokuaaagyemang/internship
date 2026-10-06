import { DataTypes, Model } from 'sequelize';

export class EmailVerificationToken extends Model {}

export function initEmailVerificationToken(sequelize) {
  EmailVerificationToken.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      usedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'EmailVerificationToken', tableName: 'email_verification_tokens' },
  );
  return EmailVerificationToken;
}
