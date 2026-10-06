import { DataTypes, Model } from 'sequelize';

// US-03: applying needs these filled in.
export const MANDATORY_PROFILE_FIELDS = ['fullName', 'university', 'department'];

export class StudentProfile extends Model {}

export function initStudentProfile(sequelize) {
  StudentProfile.init(
    {
      userId: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
      fullName: { type: DataTypes.STRING(120), allowNull: false },
      university: { type: DataTypes.STRING(150), allowNull: false },
      department: { type: DataTypes.STRING(150), allowNull: false },
      // DECIMAL comes back from mysql2 as a string; expose it as a number.
      gpa: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
        get() {
          const value = this.getDataValue('gpa');
          return value === null || value === undefined ? null : Number(value);
        },
      },
      bio: { type: DataTypes.TEXT, allowNull: true },
      resumeFileId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { sequelize, modelName: 'StudentProfile', tableName: 'student_profiles' },
  );
  return StudentProfile;
}
