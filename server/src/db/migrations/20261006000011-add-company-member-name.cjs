'use strict';

// US-09: the staff list shows names, and users have none of their own (a student's name lives in
// the profile). The rep types the supervisor's name when adding them.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('company_members', 'full_name', { type: Sequelize.STRING(120), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('company_members', 'full_name');
  },
};
