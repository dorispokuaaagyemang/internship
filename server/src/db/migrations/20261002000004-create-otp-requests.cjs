'use strict';

// US-00B, US-04: phone OTP. 6-digit code stored as a bcrypt hash, 5-minute
// expiry, 5 attempts then locked_until, 60 s resend cooldown via last_sent_at.
module.exports = {
  async up(queryInterface, Sequelize) {
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
      // Set on successful verification so a code cannot be replayed.
      consumed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('otp_requests', ['user_id', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('otp_requests');
  },
};
