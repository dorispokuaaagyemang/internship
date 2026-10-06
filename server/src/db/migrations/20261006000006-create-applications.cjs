'use strict';

// US-03, US-06..US-08. The status set is closed (US-07): an ENUM, with the allowed moves in
// applications/service.js. UNIQUE(posting_id, student_id) is what makes a second application
// to the same posting impossible (US-03), whatever happens in the API.
module.exports = {
  async up(queryInterface, Sequelize) {
    const STATUSES = ['applied', 'shortlisted', 'interviewed', 'accepted', 'rejected', 'withdrawn'];

    await queryInterface.createTable('applications', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      posting_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'postings', key: 'id' },
        onDelete: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      status: { type: Sequelize.ENUM(...STATUSES), allowNull: false, defaultValue: 'applied' },
      cover_letter: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('applications', ['posting_id', 'student_id'], {
      unique: true,
      name: 'applications_one_per_student_per_posting',
    });
    await queryInterface.addIndex('applications', ['student_id', 'created_at']);
    await queryInterface.addIndex('applications', ['posting_id', 'status']);

    // Every change, who made it and when: the student's timeline and the company's record.
    await queryInterface.createTable('application_status_history', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      application_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'applications', key: 'id' },
        onDelete: 'CASCADE',
      },
      from_status: { type: Sequelize.ENUM(...STATUSES), allowNull: true },
      to_status: { type: Sequelize.ENUM(...STATUSES), allowNull: false },
      changed_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      note: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('application_status_history', ['application_id', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('application_status_history');
    await queryInterface.dropTable('applications');
  },
};
