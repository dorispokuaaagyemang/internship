'use strict';

// US-02, US-11: every object kept in S3 storage (resumes now, certificates later) has a row
// here. The object itself is private: downloads are presigned URLs issued after an access
// check (ARCHITECTURE.md §5). checksum is the SHA-256 of the bytes as uploaded.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('files', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      owner_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      bucket: { type: Sequelize.STRING(63), allowNull: false },
      object_key: { type: Sequelize.STRING(255), allowNull: false },
      original_name: { type: Sequelize.STRING(255), allowNull: false },
      mime: { type: Sequelize.STRING(100), allowNull: false },
      size: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      checksum: { type: Sequelize.CHAR(64), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('files', ['bucket', 'object_key'], { unique: true });
    await queryInterface.addIndex('files', ['owner_user_id']);

    await queryInterface.addColumn('student_profiles', 'resume_file_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'files', key: 'id' },
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('student_profiles', 'resume_file_id');
    await queryInterface.dropTable('files');
  },
};
