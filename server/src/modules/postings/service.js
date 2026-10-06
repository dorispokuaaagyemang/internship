import { Op } from 'sequelize';
import { AppError } from '../../lib/errors.js';
import { sequelize, Company, Posting, Skill } from '../../db/models/index.js';
import { assertCanPost, companyFor } from '../companies/service.js';
import { resolveSkills, skillNames } from '../skills/service.js';

// A function, not a constant: the models are only touched when a request needs them.
const withDetails = () => ({
  include: [
    { model: Company, as: 'company', attributes: ['id', 'name', 'website'] },
    { model: Skill, as: 'skills', through: { attributes: [] } },
  ],
});

function serialize(posting) {
  return {
    id: posting.id,
    title: posting.title,
    description: posting.description,
    location: posting.location,
    domain: posting.domain,
    durationWeeks: posting.durationWeeks,
    stipend: posting.stipend,
    stipendCurrency: posting.stipendCurrency,
    deadline: posting.deadline,
    status: posting.status,
    publishedAt: posting.publishedAt,
    closedAt: posting.closedAt,
    company: posting.company ? { id: posting.company.id, name: posting.company.name, website: posting.company.website } : undefined,
    skills: skillNames(posting.skills),
    createdAt: posting.createdAt,
    updatedAt: posting.updatedAt,
  };
}

const notFound = () => new AppError(404, 'POSTING_NOT_FOUND', 'Posting not found');

// Loads a posting that belongs to the rep's company. Someone else's posting is reported
// as not found, so ids can't be probed (ARCHITECTURE.md §4.4).
async function loadOwned(postingId, companyId, options = {}) {
  const posting = await Posting.findByPk(postingId, options);
  if (!posting || posting.companyId !== companyId) throw notFound();
  return posting;
}

async function myCompanyId(userId) {
  const membership = await companyFor(userId);
  if (!membership) throw new AppError(403, 'COMPANY_REQUIRED', 'Register your company before posting internships');
  return membership.companyId;
}

export async function getPostingDetails(id) {
  return serialize(await Posting.findByPk(id, withDetails()));
}

// US-05: a verified company saves a new posting as a draft.
export async function createPosting(userId, { skills, ...fields }) {
  const company = await assertCanPost(userId);
  const posting = await sequelize.transaction(async (transaction) => {
    const created = await Posting.create({ ...fields, companyId: company.id, createdBy: userId, status: 'draft' }, { transaction });
    await created.setSkills(await resolveSkills(skills, transaction), { transaction });
    return created;
  });
  return getPostingDetails(posting.id);
}

// Only a draft can change: once published, students may have applied to what it says.
export async function updatePosting(userId, postingId, { skills, ...fields }) {
  const company = await assertCanPost(userId);
  const posting = await loadOwned(postingId, company.id);
  if (posting.status !== 'draft') {
    throw new AppError(409, 'POSTING_NOT_EDITABLE', 'Only a draft can be edited. Close this posting and create a new one instead');
  }
  await sequelize.transaction(async (transaction) => {
    await posting.update(fields, { transaction });
    await posting.setSkills(await resolveSkills(skills, transaction), { transaction });
  });
  return getPostingDetails(posting.id);
}

// US-05: draft -> active, visible to students. The deadline must still be ahead.
export async function publishPosting(userId, postingId) {
  const company = await assertCanPost(userId);
  const posting = await loadOwned(postingId, company.id);
  if (posting.deadline <= new Date()) {
    throw new AppError(409, 'DEADLINE_PASSED', 'The application deadline has passed. Set a later deadline before publishing', {
      deadline: 'Must be in the future',
    });
  }
  // Conditional update: a second click, or a posting that is not a draft, changes nothing.
  const [published] = await Posting.update(
    { status: 'active', publishedAt: new Date() },
    { where: { id: posting.id, status: 'draft' } },
  );
  if (published === 0) throw new AppError(409, 'POSTING_NOT_DRAFT', `Only a draft can be published (this one is ${posting.status})`);
  return getPostingDetails(posting.id);
}

// active -> closed by the company. Allowed whatever the company's own status, so a
// suspended company can still stop taking applications.
export async function closePosting(userId, postingId) {
  const posting = await loadOwned(postingId, await myCompanyId(userId));
  const [closed] = await Posting.update(
    { status: 'closed', closedAt: new Date() },
    { where: { id: posting.id, status: 'active' } },
  );
  if (closed === 0) throw new AppError(409, 'POSTING_NOT_ACTIVE', `Only an active posting can be closed (this one is ${posting.status})`);
  return getPostingDetails(posting.id);
}

export async function listMyPostings(userId, { status, page, limit }) {
  const companyId = await myCompanyId(userId);
  const { rows, count } = await Posting.findAndCountAll({
    where: { companyId, ...(status && { status }) },
    ...withDetails(),
    order: [['updatedAt', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return { items: rows.map(serialize), page, limit, total: count };
}

// Turns free text into a FULLTEXT boolean query where every word must match, as a prefix:
// "data analy" -> "+data* +analy*". Operator characters are dropped, so input can't change the query.
export function toBooleanQuery(q) {
  return q
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 10)
    .map((word) => `+${word}*`)
    .join(' ');
}

// An active posting is open until its deadline, even before the auto-close job has run.
const openNow = () => ({ status: 'active', deadline: { [Op.gt]: new Date() } });

// US-03: public search. Keyword over title and description, location contains, domain exact.
export async function searchPostings({ q, location, domain, page, limit }) {
  const where = { ...openNow() };
  const terms = q ? toBooleanQuery(q) : '';
  const match = terms && sequelize.literal(`MATCH (\`Posting\`.\`title\`, \`Posting\`.\`description\`) AGAINST (${sequelize.escape(terms)} IN BOOLEAN MODE)`);
  if (q && !terms) return { items: [], page, limit, total: 0 };
  if (match) where[Op.and] = [match];
  if (location) where.location = { [Op.like]: `%${location.replace(/[\\%_]/g, '\\$&')}%` };
  if (domain) where.domain = domain;

  // Two steps: page through matching ids on the postings table alone, then load those rows with
  // their company and skills. Paging with the includes attached makes Sequelize wrap the query in
  // a subquery, and MATCH cannot run against a derived table.
  const { rows: matches, count } = await Posting.findAndCountAll({
    where,
    attributes: ['id'],
    // Best match first when searching by keyword, otherwise newest first.
    order: match ? [[match, 'DESC'], ['publishedAt', 'DESC']] : [['publishedAt', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
  const ids = matches.map((p) => p.id);
  const loaded = ids.length ? await Posting.findAll({ where: { id: { [Op.in]: ids } }, ...withDetails() }) : [];
  const byId = new Map(loaded.map((p) => [p.id, p]));
  const items = ids.map((id) => byId.get(id)).filter(Boolean).map(serialize);
  return { items, page, limit, total: count };
}

// Anyone can read an active or closed posting; a draft only by its own company.
export async function getPosting(postingId, viewer) {
  const posting = await Posting.findByPk(postingId, withDetails());
  if (!posting) throw notFound();
  if (posting.status === 'draft') {
    const membership = viewer?.role === 'company_rep' ? await companyFor(viewer.id) : null;
    if (membership?.companyId !== posting.companyId) throw notFound();
  }
  return serialize(posting);
}

// US-05: the `postings.autoClose` job. Closes every active posting whose deadline has passed.
export async function closeExpiredPostings(now = new Date()) {
  const [closed] = await Posting.update(
    { status: 'closed', closedAt: now },
    { where: { status: 'active', deadline: { [Op.lte]: now } } },
  );
  return closed;
}
