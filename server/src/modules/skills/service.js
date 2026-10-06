import { Op } from 'sequelize';
import { Skill } from '../../db/models/index.js';

// Shared skill vocabulary for student profiles (US-02) and postings (US-05), so the US-06
// filter can match one against the other. Finds or creates each skill. Names match
// case-insensitively (column collation), and a skill that already exists keeps its spelling.
export async function resolveSkills(names, transaction) {
  const unique = uniqueSkillNames(names);
  if (unique.length === 0) return [];
  await Skill.bulkCreate(
    unique.map((name) => ({ name })),
    { ignoreDuplicates: true, transaction },
  );
  return Skill.findAll({ where: { name: { [Op.in]: unique } }, transaction });
}

// Drops names that differ only in case, keeping the first spelling given.
export function uniqueSkillNames(names) {
  const byKey = new Map();
  for (const name of names ?? []) if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  return [...byKey.values()];
}

export const skillNames =(skills) => (skills ?? []).map((s) => s.name).sort((a, b) => a.localeCompare(b));
