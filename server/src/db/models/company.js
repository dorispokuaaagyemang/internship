import { DataTypes, Model } from 'sequelize';

export const COMPANY_STATUSES = ['pending_verification', 'verified', 'suspended'];
export const MEMBER_ROLES = ['rep', 'supervisor'];

export class Company extends Model {}
export class CompanyMember extends Model {}

export function initCompany(sequelize) {
  Company.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      regNumber: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      contactPhone: { type: DataTypes.STRING(16), allowNull: false },
      website: { type: DataTypes.STRING(255), allowNull: true },
      status: { type: DataTypes.ENUM(...COMPANY_STATUSES), allowNull: false, defaultValue: 'pending_verification' },
      verifiedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      verifiedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'Company', tableName: 'companies' },
  );
  return Company;
}

export function initCompanyMember(sequelize) {
  CompanyMember.init(
    {
      companyId: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
      memberRole: { type: DataTypes.ENUM(...MEMBER_ROLES), allowNull: false },
      // US-09: the staff member's name, as the rep entered it.
      fullName: { type: DataTypes.STRING(120), allowNull: true },
    },
    { sequelize, modelName: 'CompanyMember', tableName: 'company_members' },
  );
  return CompanyMember;
}
