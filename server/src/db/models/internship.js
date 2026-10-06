import { DataTypes, Model } from 'sequelize';

export const INTERNSHIP_STATUSES = ['ongoing', 'completed'];
export const ATTENDANCE = ['excellent', 'good', 'fair', 'poor'];

const immutable = () => {
  throw new Error('Evaluations are append-only (US-10)');
};

export class AccountInvite extends Model {}
export class Internship extends Model {}
export class SupervisorAssignment extends Model {}
export class Evaluation extends Model {}

// US-09: single-use link for an invited supervisor to set a password (token stored as SHA-256 hex).
export function initAccountInvite(sequelize) {
  AccountInvite.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      invitedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      usedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'AccountInvite', tableName: 'account_invites' },
  );
  return AccountInvite;
}

// US-09..US-11: created when an application is Accepted.
export function initInternship(sequelize) {
  Internship.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      applicationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
      // 'YYYY-MM-DD'
      startDate: { type: DataTypes.DATEONLY, allowNull: false },
      endDate: { type: DataTypes.DATEONLY, allowNull: false },
      status: { type: DataTypes.ENUM(...INTERNSHIP_STATUSES), allowNull: false, defaultValue: 'ongoing' },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      completedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { sequelize, modelName: 'Internship', tableName: 'internships' },
  );
  return Internship;
}

// US-09: active_key (internship id while active, else NULL) is a VIRTUAL generated column with a
// UNIQUE index, so the database itself allows one active supervisor per intern. It is never written.
export function initSupervisorAssignment(sequelize) {
  SupervisorAssignment.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      internshipId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      supervisorUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      assignedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      endedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'SupervisorAssignment', tableName: 'supervisor_assignments', timestamps: false },
  );
  return SupervisorAssignment;
}

// US-10: timestamped and read-only once saved; the rating range is also a CHECK in the database.
export function initEvaluation(sequelize) {
  Evaluation.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      internshipId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      supervisorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      period: { type: DataTypes.STRING(50), allowNull: false },
      rating: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, validate: { min: 1, max: 5 } },
      comments: { type: DataTypes.TEXT, allowNull: false },
      attendance: { type: DataTypes.ENUM(...ATTENDANCE), allowNull: false },
      isFinal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'Evaluation',
      tableName: 'evaluations',
      updatedAt: false,
      hooks: {
        beforeUpdate: immutable,
        beforeBulkUpdate: immutable,
        beforeDestroy: immutable,
        beforeBulkDestroy: immutable,
      },
    },
  );
  return Evaluation;
}

// US-11: one per internship; the PDF is a StoredFile in the certificates bucket.
export class Certificate extends Model {}

export function initCertificate(sequelize) {
  Certificate.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      internshipId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
      fileId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      serialNo: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      issuedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, modelName: 'Certificate', tableName: 'certificates', timestamps: false },
  );
  return Certificate;
}
