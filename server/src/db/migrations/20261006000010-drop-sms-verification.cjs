'use strict';

// SMS phone verification (US-00B) was dropped on 2026-10-06: an SMS gateway can't be used.
// Accounts now activate on email verification alone (password accounts) or at once (Google).
// The phone number is still collected and format-checked, but no longer verified.
module.exports = {
  async up(queryInterface) {
    // Accounts that were only waiting for the SMS code can be used now.
    await queryInterface.sequelize.query(
      "UPDATE users SET status = 'active' WHERE status = 'pending' AND (password_hash IS NULL OR email_verified_at IS NOT NULL)",
    );
    await queryInterface.dropTable('otp_requests');
    await queryInterface.removeColumn('users', 'phone_verified_at');
  },

  // Restores the schema only; the codes and verification times are gone.
  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'phone_verified_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.createTable('otp_requests', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      phone_e164: { type: Sequelize.STRING(16), allowNull: false },
      code_hash: { type: Sequelize.STRING(255), allowNull: false },
      channel: { type: Sequelize.ENUM('sms', 'email'), allowNull: false, defaultValue: 'sms' },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      attempts: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      locked_until: { type: Sequelize.DATE, allowNull: true },
      last_sent_at: { type: Sequelize.DATE, allowNull: false },
      consumed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },
};
