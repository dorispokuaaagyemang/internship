'use strict';

// US-11: one certificate per internship, issued once it is completed. The PDF lives in the
// certificates bucket (a `files` row); the serial number is printed on it and is unique.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('certificates', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      internship_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        unique: true,
        references: { model: 'internships', key: 'id' },
        onDelete: 'CASCADE',
      },
      file_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'files', key: 'id' },
        onDelete: 'RESTRICT',
      },
      serial_no: { type: Sequelize.STRING(32), allowNull: false, unique: true },
      issued_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('certificates');
  },
};
