import { DataTypes, Model } from 'sequelize';

// Named StoredFile because File is a Node.js global.
export class StoredFile extends Model {}

export function initStoredFile(sequelize) {
  StoredFile.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      ownerUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      bucket: { type: DataTypes.STRING(63), allowNull: false },
      objectKey: { type: DataTypes.STRING(255), allowNull: false },
      originalName: { type: DataTypes.STRING(255), allowNull: false },
      mime: { type: DataTypes.STRING(100), allowNull: false },
      size: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      checksum: { type: DataTypes.CHAR(64), allowNull: false },
    },
    { sequelize, modelName: 'StoredFile', tableName: 'files' },
  );
  return StoredFile;
}
