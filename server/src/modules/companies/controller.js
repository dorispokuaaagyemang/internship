import * as companies from './service.js';

// US-04
export async function register(req, res) {
  res.status(201).json({ company: await companies.registerCompany(req.user.id, req.body, { ip: req.ip }) });
}

export async function getMine(req, res) {
  res.json({ company: await companies.getMyCompany(req.user.id) });
}

// US-09: staff
export async function listStaff(req, res) {
  res.json({ items: await companies.listStaff(req.user.id) });
}

export async function addStaff(req, res) {
  res.status(201).json({ member: await companies.addStaff(req.user.id, req.body, { ip: req.ip }) });
}

export async function resendInvite(req, res) {
  await companies.resendInvite(req.user.id, Number(req.params.userId));
  res.status(202).json({ message: 'Invitation sent' });
}

// --- Admin ---

export async function list(req, res) {
  res.json(await companies.listCompanies(req.query));
}

export async function approve(req, res) {
  res.json({ company: await companies.approveCompany(Number(req.params.id), req.user, { ip: req.ip }) });
}
