import { DataTypes, Model } from 'sequelize';

export const ROLES = ['student', 'company_rep', 'supervisor', 'admin'];
export const USER_STATUSES = ['pending', 'active', 'suspended'];

export class User extends Model {
  // Never serialize the password hash or Google subject into a response.
  toJSON() {
    const values = { ...this.get() };
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
      passwordHash: { type: DataTypes.STRING(255), allowNull: true },
      googleId: { type: DataTypes.STRING(255), allowNull: true, unique: true },
      role: { type: DataTypes.ENUM(...ROLES), allowNull: false },
      status: { type: DataTypes.ENUM(...USER_STATUSES), allowNull: false, defaultValue: 'pending' },
      emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      phoneE164: { type: DataTypes.STRING(16), allowNull: true },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'User', tableName: 'users', paranoid: true },
  );
  return User;
}
