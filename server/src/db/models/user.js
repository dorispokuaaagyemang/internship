import { DataTypes, Model } from 'sequelize';

export const ROLES = ['student', 'company_rep', 'supervisor', 'admin'];
export const USER_STATUSES = ['pending', 'active', 'suspended'];

export class User extends Model {
  // Never serialize the password hash or Google subject into a response.
  toJSON() {
    const values = { ...this.get() };
    // Which sign-in methods exist, without the secrets themselves (the account page uses it).
    values.hasPassword = Boolean(values.passwordHash);
    values.googleLinked = Boolean(values.googleId);
    delete values.passwordHash;
    delete values.googleId;
    return values;
  }
}

export function initUser(sequelize) {
  User.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      // US-00A, US-01: typed at registration or taken from Google.
      displayName: { type: DataTypes.STRING(120), allowNull: true },
      passwordHash: { type: DataTypes.STRING(255), allowNull: true },
      googleId: { type: DataTypes.STRING(255), allowNull: true, unique: true },
      role: { type: DataTypes.ENUM(...ROLES), allowNull: false },
      status: { type: DataTypes.ENUM(...USER_STATUSES), allowNull: false, defaultValue: 'pending' },
      emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      phoneE164: { type: DataTypes.STRING(16), allowNull: true },
      // Last sign-in or session renewal (at most daily): the retention job's measure of activity.
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
      // Data protection: when the account was erased (anonymised), and when it was warned about inactivity.
      anonymisedAt: { type: DataTypes.DATE, allowNull: true },
      retentionWarnedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'User', tableName: 'users', paranoid: true },
  );
  return User;
}
