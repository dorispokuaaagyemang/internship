'use strict';

// US-06, US-07, US-08: in-app notifications. One row per recipient, written by the listeners
// in modules/notifications/listeners.js and pushed live over Socket.IO (ARCHITECTURE.md §5.2).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notifications', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      type: { type: Sequelize.STRING(50), allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },
      read_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    // The bell: a user's newest first, and their unread count.
    await queryInterface.addIndex('notifications', ['user_id', 'created_at']);
    await queryInterface.addIndex('notifications', ['user_id', 'read_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notifications');
  },
};
