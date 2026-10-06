'use strict';

// US-02, US-06: a shared skill vocabulary. Students list skills on their profile;
// postings will require them (posting_skills, phase 4). The default MySQL 8 collation
// is case-insensitive, so "React" and "react" are the same skill.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('skills', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('student_skills', {
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        references: { model: 'student_profiles', key: 'user_id' },
        onDelete: 'CASCADE',
      },
      skill_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        references: { model: 'skills', key: 'id' },
        onDelete: 'CASCADE',
      },
    });
    // Filtering applicants by skill looks up by skill first.
    await queryInterface.addIndex('student_skills', ['skill_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('student_skills');
    await queryInterface.dropTable('skills');
  },
};
