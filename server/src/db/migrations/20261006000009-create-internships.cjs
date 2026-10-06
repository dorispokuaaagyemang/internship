'use strict';

// US-09..US-11. An internship exists once an application is Accepted (one per application).
// Exactly one active supervisor per intern is a database rule: active_key is the internship id
// while the assignment is active and NULL otherwise, and it is UNIQUE (ARCHITECTURE.md §3).
// It is VIRTUAL, not STORED: MySQL refuses a stored generated column whose base column
// (internship_id) has an ON DELETE CASCADE foreign key.
// Evaluations are append-only; the rating range is a CHECK constraint (US-10).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('internships', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      application_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        unique: true,
        references: { model: 'applications', key: 'id' },
        onDelete: 'CASCADE',
      },
      start_date: { type: Sequelize.DATEONLY, allowNull: false },
      end_date: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.ENUM('ongoing', 'completed'), allowNull: false, defaultValue: 'ongoing' },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      completed_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.sequelize.query(
      'ALTER TABLE internships ADD CONSTRAINT internships_dates_in_order CHECK (end_date >= start_date)',
    );

    await queryInterface.createTable('supervisor_assignments', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      internship_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'internships', key: 'id' },
        onDelete: 'CASCADE',
      },
      supervisor_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      assigned_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      assigned_at: { type: Sequelize.DATE, allowNull: false },
      ended_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.sequelize.query(
      'ALTER TABLE supervisor_assignments ADD COLUMN active_key INT UNSIGNED ' +
        'GENERATED ALWAYS AS (IF(active, internship_id, NULL)) VIRTUAL, ' +
        'ADD UNIQUE INDEX supervisor_assignments_one_active_per_internship (active_key)',
    );
    // "My interns": a supervisor's active assignments.
    await queryInterface.addIndex('supervisor_assignments', ['supervisor_user_id', 'active']);

    await queryInterface.createTable('evaluations', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      internship_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'internships', key: 'id' },
        onDelete: 'CASCADE',
      },
      supervisor_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      period: { type: Sequelize.STRING(50), allowNull: false },
      rating: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false },
      comments: { type: Sequelize.TEXT, allowNull: false },
      attendance: { type: Sequelize.ENUM('excellent', 'good', 'fair', 'poor'), allowNull: false },
      is_final: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.sequelize.query(
      'ALTER TABLE evaluations ADD CONSTRAINT evaluations_rating_1_to_5 CHECK (rating BETWEEN 1 AND 5)',
    );
    await queryInterface.addIndex('evaluations', ['internship_id', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('evaluations');
    await queryInterface.dropTable('supervisor_assignments');
    await queryInterface.dropTable('internships');
  },
};
