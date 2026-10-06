import * as students from './service.js';

// US-02: { profile, completeness }. profile is null until the first save.
export async function getMe(req, res) {
  res.json(await students.getProfile(req.user.id));
}

export async function updateMe(req, res) {
  res.json(await students.saveProfile(req.user.id, req.body));
}

export async function uploadResume(req, res) {
  res.status(201).json(await students.uploadResume(req.user.id, req.file));
}

// Returns a 5-minute link rather than the bytes, so large files never pass through the API.
export async function getResume(req, res) {
  res.json(await students.getResumeDownload(req.user.id));
}

export async function deleteResume(req, res) {
  await students.deleteResume(req.user.id);
  res.status(204).end();
}
