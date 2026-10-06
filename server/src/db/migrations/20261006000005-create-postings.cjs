'use strict';

// US-05: draft -> active (publish) -> closed (deadline passed or closed by the company).
// US-03: search within 2 s, so FULLTEXT on title/description plus indexes for the
// location/domain filters and the (status, deadline) scan the auto-close job runs.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('postings', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      company_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'companies', key: 'id' },
        onDelete: 'CASCADE',
      },
      created_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      title: { type: Sequelize.STRING(150), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      location: { type: Sequelize.STRING(100), allowNull: false },
      domain: { type: Sequelize.STRING(80), allowNull: false },
      duration_weeks: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false },
      // Monthly stipend; 0 means unpaid.
      stipend: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      stipend_currency: { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'KES' },
      deadline: { type: Sequelize.DATE, allowNull: false },
      status: { type: Sequelize.ENUM('draft', 'active', 'closed'), allowNull: false, defaultValue: 'draft' },
      published_at: { type: Sequelize.DATE, allowNull: true },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('postings', ['title', 'description'], { type: 'FULLTEXT', name: 'postings_fulltext' });
    await queryInterface.addIndex('postings', ['status', 'deadline']);
    await queryInterface.addIndex('postings', ['location']);
    await queryInterface.addIndex('postings', ['domain']);
    await queryInterface.addIndex('postings', ['company_id', 'status']);

    await queryInterface.createTable('posting_skills', {
      posting_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        references: { model: 'postings', key: 'id' },
        onDelete: 'CASCADE',
      },
      skill_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        references: { model: 'skills', key: 'id' },
        onDelete: 'CASCADE',
      },
    });
    await queryInterface.addIndex('posting_skills', ['skill_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('posting_skills');
    await queryInterface.dropTable('postings');
  },
};
