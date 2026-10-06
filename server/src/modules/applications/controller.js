import * as applications from './service.js';

const id = (req) => Number(req.params.id);

// US-03: mounted at POST /postings/:id/apply.
export async function apply(req, res) {
  res.status(201).json({ application: await applications.apply(req.user.id, id(req), req.body) });
}

// US-07
export async function listMine(req, res) {
  res.json(await applications.listMine(req.user.id, req.query));
}

export async function get(req, res) {
  res.json({ application: await applications.getApplication(id(req), req.user) });
}

// US-08
export async function withdraw(req, res) {
  res.json({ application: await applications.withdraw(req.user.id, id(req)) });
}

// US-06
export async function changeStatus(req, res) {
  res.json({ application: await applications.changeStatus(req.user.id, id(req), req.body) });
}

// US-06: mounted at GET /postings/:id/applications.
export async function listForPosting(req, res) {
  res.json(await applications.listForPosting(req.user.id, id(req), req.query));
}

export async function getResume(req, res) {
  res.json(await applications.getApplicantResume(req.user.id, id(req)));
}
