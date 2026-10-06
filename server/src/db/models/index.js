// Model registry: initialises every model on the shared connection and wires
// associations. Import models from here, not from their own files.
import { sequelize } from '../index.js';
import { initUser, User } from './user.js';
import { initRefreshToken, RefreshToken } from './refresh-token.js';
import { initEmailVerificationToken, EmailVerificationToken } from './email-verification-token.js';
import { initAuditLog, AuditLog } from './audit-log.js';
import { initStudentProfile, StudentProfile } from './student-profile.js';
import { initSkill, Skill } from './skill.js';
import { initStoredFile, StoredFile } from './stored-file.js';
import { initCompany, initCompanyMember, Company, CompanyMember } from './company.js';
import { initPosting, Posting } from './posting.js';
import {
  initApplication,
  initApplicationStatusHistory,
  Application,
  ApplicationStatusHistory,
} from './application.js';
import { initNotification, Notification } from './notification.js';
import {
  initAccountInvite,
  initInternship,
  initSupervisorAssignment,
  initEvaluation,
  initCertificate,
  AccountInvite,
  Internship,
  SupervisorAssignment,
  Evaluation,
  Certificate,
} from './internship.js';

initUser(sequelize);
initRefreshToken(sequelize);
initEmailVerificationToken(sequelize);
initAuditLog(sequelize);
initStudentProfile(sequelize);
initSkill(sequelize);
initStoredFile(sequelize);
initCompany(sequelize);
initCompanyMember(sequelize);
initPosting(sequelize);
initApplication(sequelize);
initApplicationStatusHistory(sequelize);
initNotification(sequelize);
initAccountInvite(sequelize);
initInternship(sequelize);
initSupervisorAssignment(sequelize);
initEvaluation(sequelize);
initCertificate(sequelize);

User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
RefreshToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(EmailVerificationToken, { foreignKey: 'userId', as: 'emailVerificationTokens' });
EmailVerificationToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });


User.hasMany(AuditLog, { foreignKey: 'actorId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'actorId', as: 'actor' });

User.hasOne(StudentProfile, { foreignKey: 'userId', as: 'studentProfile' });
StudentProfile.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// student_skills has no model of its own: it is only ever read and written through this pair.
StudentProfile.belongsToMany(Skill, { through: 'student_skills', foreignKey: 'userId', otherKey: 'skillId', as: 'skills', timestamps: false });
Skill.belongsToMany(StudentProfile, { through: 'student_skills', foreignKey: 'skillId', otherKey: 'userId', as: 'students', timestamps: false });

User.hasMany(StoredFile, { foreignKey: 'ownerUserId', as: 'files' });
StoredFile.belongsTo(User, { foreignKey: 'ownerUserId', as: 'owner' });
StudentProfile.belongsTo(StoredFile, { foreignKey: 'resumeFileId', as: 'resume' });

Company.hasMany(CompanyMember, { foreignKey: 'companyId', as: 'members' });
CompanyMember.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
CompanyMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasOne(CompanyMember, { foreignKey: 'userId', as: 'membership' });
Company.belongsTo(User, { foreignKey: 'verifiedBy', as: 'verifier' });

Company.hasMany(Posting, { foreignKey: 'companyId', as: 'postings' });
Posting.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Posting.belongsToMany(Skill, { through: 'posting_skills', foreignKey: 'postingId', otherKey: 'skillId', as: 'skills', timestamps: false });
Skill.belongsToMany(Posting, { through: 'posting_skills', foreignKey: 'skillId', otherKey: 'postingId', as: 'postings', timestamps: false });

Posting.hasMany(Application, { foreignKey: 'postingId', as: 'applications' });
Application.belongsTo(Posting, { foreignKey: 'postingId', as: 'posting' });
Application.belongsTo(User, { foreignKey: 'studentId', as: 'student' });
// Straight to the applicant's profile (student_profiles is keyed by user_id), for the US-06 filters.
Application.belongsTo(StudentProfile, { foreignKey: 'studentId', targetKey: 'userId', as: 'profile', constraints: false });
Application.hasMany(ApplicationStatusHistory, { foreignKey: 'applicationId', as: 'history' });
ApplicationStatusHistory.belongsTo(Application, { foreignKey: 'applicationId', as: 'application' });

User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });

// --- Supervision (US-09..US-11) ---
AccountInvite.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Application.hasOne(Internship, { foreignKey: 'applicationId', as: 'internship' });
Internship.belongsTo(Application, { foreignKey: 'applicationId', as: 'application' });
Internship.hasMany(SupervisorAssignment, { foreignKey: 'internshipId', as: 'assignments' });
// The current supervisor, if any (at most one: see SupervisorAssignment).
Internship.hasOne(SupervisorAssignment, { foreignKey: 'internshipId', as: 'activeAssignment', scope: { active: true } });
SupervisorAssignment.belongsTo(Internship, { foreignKey: 'internshipId', as: 'internship' });
SupervisorAssignment.belongsTo(User, { foreignKey: 'supervisorUserId', as: 'supervisor' });
Internship.hasMany(Evaluation, { foreignKey: 'internshipId', as: 'evaluations' });
Evaluation.belongsTo(Internship, { foreignKey: 'internshipId', as: 'internship' });
Evaluation.belongsTo(User, { foreignKey: 'supervisorId', as: 'supervisor' });
Internship.hasOne(Certificate, { foreignKey: 'internshipId', as: 'certificate' });
Certificate.belongsTo(Internship, { foreignKey: 'internshipId', as: 'internship' });
Certificate.belongsTo(StoredFile, { foreignKey: 'fileId', as: 'file' });

export {
  sequelize,
  User,
  RefreshToken,
  EmailVerificationToken,
  AuditLog,
  StudentProfile,
  Skill,
  StoredFile,
  Company,
  CompanyMember,
  Posting,
  Application,
  ApplicationStatusHistory,
  Notification,
  AccountInvite,
  Internship,
  SupervisorAssignment,
  Evaluation,
  Certificate,
};
