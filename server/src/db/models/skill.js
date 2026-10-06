import { DataTypes, Model } from 'sequelize';

export class Skill extends Model {}

export function initSkill(sequelize) {
  Skill.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    },
    { sequelize, modelName: 'Skill', tableName: 'skills' },
  );
  return Skill;
}
