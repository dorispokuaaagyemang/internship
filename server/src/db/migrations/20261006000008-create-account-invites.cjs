'use strict';

// US-09: supervisors don't self-register; a company rep adds them to the staff list. The new
// account gets a single-use link to set its password (token stored as SHA-256 hex, like
// email verification). Using the link also confirms the email address.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('account_invites', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      invited_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      token_hash: { type: Sequelize.CHAR(64), allowNull: false, unique: true },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      used_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('account_invites', ['user_id', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('account_invites');
  },
};
