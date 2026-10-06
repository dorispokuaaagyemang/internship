import { createHash, randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../../config/index.js';
import { AppError } from '../../lib/errors.js';
import logger from '../../lib/logger.js';
import { deleteObject, presignDownload, putObject, DOWNLOAD_URL_TTL_SECONDS } from '../../integrations/storage.js';
import { sequelize, StudentProfile, Skill, StoredFile } from '../../db/models/index.js';
import { MANDATORY_PROFILE_FIELDS } from '../../db/models/student-profile.js';
import { resolveSkills, skillNames } from '../skills/service.js';

// US-02: resumes are PDF or DOCX under 5 MB. The type comes from the file's bytes, not its
// name or the browser's Content-Type, so a renamed .exe is refused.
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
const RESUME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// A function, not a constant: the models are only touched when a request needs them.
const withDetails = () => ({
  include: [
    { model: Skill, as: 'skills', through: { attributes: [] } },
    { model: StoredFile, as: 'resume' },
  ],
});

function serialize(profile) {
  const { resume } = profile;
  return {
    fullName: profile.fullName,
    university: profile.university,
    department: profile.department,
    gpa: profile.gpa,
    bio: profile.bio,
    skills: skillNames(profile.skills),
    resume: resume
      ? { fileName: resume.originalName, mime: resume.mime, size: resume.size, uploadedAt: resume.createdAt }
      : null,
    updatedAt: profile.updatedAt,
  };
}

// US-03: the gate applying will use. Lists what is missing so the client can say so.
export function completeness(profile) {
  const missing = MANDATORY_PROFILE_FIELDS.filter((field) => !profile?.[field]);
  return { complete: missing.length === 0, missing };
}

export async function isProfileComplete(userId) {
  return completeness(await StudentProfile.findByPk(userId)).complete;
}

export async function getProfile(userId) {
  const profile = await StudentProfile.findByPk(userId, withDetails());
  return { profile: profile ? serialize(profile) : null, completeness: completeness(profile) };
}

// US-02: creates or replaces the profile. The validator has already refused a save with
// a mandatory field missing. updated_at records when it changed. The resume is untouched:
// upsert only writes the columns it is given.
export async function saveProfile(userId, { skills, ...fields }) {
  await sequelize.transaction(async (transaction) => {
    const [profile] = await StudentProfile.upsert({ userId, ...fields }, { transaction });
    await profile.setSkills(await resolveSkills(skills, transaction), { transaction });
  });
  return getProfile(userId);
}

// --- Resume (US-02) ---

// Removes an object and its row once nothing points at it. Failures only leave an orphan
// behind, so they are logged rather than failing the request.
async function discardFile(file) {
  try {
    await deleteObject({ bucket: file.bucket, key: file.objectKey });
    await StoredFile.destroy({ where: { id: file.id } });
  } catch (err) {
    logger.warn({ err: err.message, fileId: file.id }, 'Could not delete a replaced file');
  }
}

// Keeps the uploader's name for the download, minus any path, with the real extension.
function downloadName(originalName, ext) {
  const base = (originalName ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]*$/, '')
    .replace(/[\p{Cc}"]/gu, '')
    .trim()
    .slice(0, 200);
  return `${base || 'resume'}.${ext}`;
}

export async function uploadResume(userId, file) {
  const profile = await StudentProfile.findByPk(userId, { include: [{ model: StoredFile, as: 'resume' }] });
  if (!profile) {
    throw new AppError(409, 'PROFILE_REQUIRED', 'Save your profile before uploading a resume');
  }

  const type = await fileTypeFromBuffer(file.buffer);
  if (!type || !RESUME_TYPES[type.ext]) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload your resume as a PDF or Word (.docx) file', {
      resume: 'Only PDF or DOCX files are accepted',
    });
  }

  const bucket = config.s3.buckets.resumes;
  const key = `students/${userId}/${randomUUID()}.${type.ext}`;
  const mime = RESUME_TYPES[type.ext];
  await putObject({ bucket, key, body: file.buffer, contentType: mime });

  try {
    await sequelize.transaction(async (transaction) => {
      const stored = await StoredFile.create(
        {
          ownerUserId: userId,
          bucket,
          objectKey: key,
          originalName: downloadName(file.originalname, type.ext),
          mime,
          size: file.size,
          checksum: createHash('sha256').update(file.buffer).digest('hex'),
        },
        { transaction },
      );
      await profile.update({ resumeFileId: stored.id }, { transaction });
    });
  } catch (err) {
    // The row never committed, so the object would be unreachable: remove it.
    await deleteObject({ bucket, key }).catch(() => {});
    throw err;
  }

  if (profile.resume) await discardFile(profile.resume);
  return getProfile(userId);
}

// A link valid for 5 minutes (ARCHITECTURE.md §5). The browser downloads straight from storage.
export async function getResumeDownload(userId) {
  const profile = await StudentProfile.findByPk(userId, { include: [{ model: StoredFile, as: 'resume' }] });
  const resume = profile?.resume;
  if (!resume) throw new AppError(404, 'RESUME_NOT_FOUND', 'No resume uploaded yet');

  const url = await presignDownload({
    bucket: resume.bucket,
    key: resume.objectKey,
    downloadName: resume.originalName,
    contentType: resume.mime,
  });
  return {
    url,
    expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    fileName: resume.originalName,
    mime: resume.mime,
    size: resume.size,
  };
}

export async function deleteResume(userId) {
  const profile = await StudentProfile.findByPk(userId, { include: [{ model: StoredFile, as: 'resume' }] });
  if (!profile?.resume) return;
  await profile.update({ resumeFileId: null });
  await discardFile(profile.resume);
}
