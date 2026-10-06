import * as postings from './service.js';

const id = (req) => Number(req.params.id);

// US-03: public search and detail.
export async function search(req, res) {
  res.json(await postings.searchPostings(req.query));
}

export async function get(req, res) {
  res.json({ posting: await postings.getPosting(id(req), req.user) });
}

// US-05: company reps.
export async function create(req, res) {
  res.status(201).json({ posting: await postings.createPosting(req.user.id, req.body) });
}

export async function update(req, res) {
  res.json({ posting: await postings.updatePosting(req.user.id, id(req), req.body) });
}

export async function publish(req, res) {
  res.json({ posting: await postings.publishPosting(req.user.id, id(req)) });
}

export async function close(req, res) {
  res.json({ posting: await postings.closePosting(req.user.id, id(req)) });
}

export async function listMine(req, res) {
  res.json(await postings.listMyPostings(req.user.id, req.query));
}
