'use strict';

// US-02: one profile per student, keyed by the user. name, university and department
// are mandatory before a student can apply (US-03). The resume column arrives with the
// files table. updated_at is the "timestamp logged" on every change.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('student_profiles', {
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      full_name: { type: Sequelize.STRING(120), allowNull: false },
      university: { type: Sequelize.STRING(150), allowNull: false },
      department: { type: Sequelize.STRING(150), allowNull: false },
      gpa: { type: Sequelize.DECIMAL(3, 2), allowNull: true },
      bio: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    // Company-side applicant filters (US-06, ARCHITECTURE.md §3).
    await queryInterface.addIndex('student_profiles', ['university']);
    await queryInterface.addIndex('student_profiles', ['gpa']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('student_profiles');
  },
};
