'use strict';

// Data protection (Kenya Data Protection Act 2019 / GDPR): an erased account is anonymised, not
// removed, so other people's records (applications, evaluations, audit log) stay consistent.
// retention_warned_at: when the "inactive for almost a year" email went out (privacy/service.js).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'anonymised_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('users', 'retention_warned_at', { type: Sequelize.DATE, allowNull: true });
    // The retention job looks for inactive accounts.
    await queryInterface.addIndex('users', ['last_login_at']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', ['last_login_at']);
    await queryInterface.removeColumn('users', 'retention_warned_at');
    await queryInterface.removeColumn('users', 'anonymised_at');
  },
};
