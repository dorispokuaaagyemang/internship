'use strict';

// US-04: a company starts pending_verification and only an admin moves it to verified
// (ARCHITECTURE.md §5.1). contact_phone is the rep's number, already verified by SMS OTP.
// company_members links users to their company; a user belongs to at most one.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('companies', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(150), allowNull: false },
      reg_number: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      contact_phone: { type: Sequelize.STRING(16), allowNull: false },
      website: { type: Sequelize.STRING(255), allowNull: true },
      status: {
        type: Sequelize.ENUM('pending_verification', 'verified', 'suspended'),
        allowNull: false,
        defaultValue: 'pending_verification',
      },
      verified_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      verified_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    // The admin queue lists companies by status, oldest first.
    await queryInterface.addIndex('companies', ['status', 'created_at']);

    await queryInterface.createTable('company_members', {
      company_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        references: { model: 'companies', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      member_role: { type: Sequelize.ENUM('rep', 'supervisor'), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('company_members', ['user_id'], { unique: true, name: 'company_members_one_company_per_user' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('company_members');
    await queryInterface.dropTable('companies');
  },
};
