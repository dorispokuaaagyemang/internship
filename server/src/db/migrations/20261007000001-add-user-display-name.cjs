'use strict';

// US-00A, US-01: the name typed at registration, or the one Google returns, so every account has
// a name from the start. A student's profile name (student_profiles.full_name) starts from it.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'display_name', { type: Sequelize.STRING(120), allowNull: true });
    // Existing accounts: take the name already known from a profile or a staff entry.
    await queryInterface.sequelize.query(
      'UPDATE users u LEFT JOIN student_profiles p ON p.user_id = u.id LEFT JOIN company_members m ON m.user_id = u.id ' +
        'SET u.display_name = COALESCE(p.full_name, m.full_name) WHERE u.display_name IS NULL',
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'display_name');
  },
};
