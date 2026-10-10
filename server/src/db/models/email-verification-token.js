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

// US-01: "forgot password" links; the same shape as verification links.
export class PasswordResetToken extends Model {}

export function initPasswordResetToken(sequelize) {
  PasswordResetToken.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      usedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'PasswordResetToken', tableName: 'password_reset_tokens' },
  );
  return PasswordResetToken;
}
