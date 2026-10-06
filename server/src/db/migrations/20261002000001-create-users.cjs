'use strict';

// US-00A, US-00B, US-01: one row per account, whichever way it signs in.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      email: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      // Null for Google-only accounts.
      password_hash: { type: Sequelize.STRING(255), allowNull: true },
      google_id: { type: Sequelize.STRING(255), allowNull: true, unique: true },
      role: {
        type: Sequelize.ENUM('student', 'company_rep', 'supervisor', 'admin'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'active', 'suspended'),
        allowNull: false,
        defaultValue: 'pending',
      },
      email_verified_at: { type: Sequelize.DATE, allowNull: true },
      phone_e164: { type: Sequelize.STRING(16), allowNull: true },
      phone_verified_at: { type: Sequelize.DATE, allowNull: true },
      last_login_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('users', ['role', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
