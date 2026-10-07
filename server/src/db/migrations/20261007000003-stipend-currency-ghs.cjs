'use strict';

// The platform serves Ghana: stipends default to Ghana cedis (GHS). Existing postings keep the
// currency they were saved with.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('postings', 'stipend_currency', { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'GHS' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('postings', 'stipend_currency', { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'KES' });
  },
};
