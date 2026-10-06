'use strict';

// US-12 and Module 1: admin actions and auth events, with actor and timestamp.
// Insert-only: the model rejects updates/deletes; the production DB grant
// (INSERT, SELECT only) is applied at deployment (roadmap phase 7).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      id: { type: Sequelize.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      // Null for anonymous events such as a failed login for an unknown email.
      actor_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      actor_role: { type: Sequelize.STRING(32), allowNull: true },
      action: { type: Sequelize.STRING(64), allowNull: false },
      entity_type: { type: Sequelize.STRING(64), allowNull: true },
      entity_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      ip: { type: Sequelize.STRING(45), allowNull: true },
      metadata: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('audit_logs', ['actor_id', 'created_at']);
    await queryInterface.addIndex('audit_logs', ['action', 'created_at']);
    await queryInterface.addIndex('audit_logs', ['entity_type', 'entity_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
