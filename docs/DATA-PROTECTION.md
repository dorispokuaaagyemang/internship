# Data protection: reviewer's pack

Prepared by the development team for whoever reviews the platform against the **Kenya Data
Protection Act, 2019** (and the GDPR, if users in the EU are expected). It describes what the system
does today, so the review can focus on the legal questions at the end. **This is not legal advice.**

The user-facing notice is the page `/privacy` (`client/src/features/account/PrivacyPage.jsx`).
Its controller name, contact address and retention periods come from the server configuration
(`DATA_CONTROLLER_NAME`, `PRIVACY_CONTACT_EMAIL`) and from `server/src/modules/privacy/service.js`.

## 1. Record of processing

| Activity | Whose data | Data | Purpose | Proposed legal basis | Retention |
|---|---|---|---|---|---|
| Accounts | Students, company reps, supervisors, admins | Name, email, phone, password hash or Google id, sign-in times | Provide the service, sign-in | Performance of a contract | Until deleted by the user; 1 year after last use (30-day warning) |
| Student profiles | Students | University, department, GPA, skills, bio, resume file | Let students apply; let companies assess | Contract (shared with a company only when the student applies) | With the account; resume 6 months after last use |
| Applications | Students, companies | Cover letter, status history and notes | Recruitment process | Contract | With the account; anonymised (not deleted) on erasure |
| Internships | Students, supervisors, companies | Dates, supervisor, evaluations, certificate PDF | Supervision and certification | Contract; legitimate interests of the host company | With the account; certificate removed on erasure |
| Companies and staff | Company reps, supervisors | Company name, registration number, contact phone, staff names and emails | Verify companies; run supervision | Contract; legitimate interest (fraud prevention) | With the company/account |
| Notifications and email | All users | Email address, event details | Inform users of changes | Contract | Read notifications 180 days; all on erasure |
| Security (audit) log | All users | Action, actor id and role, IP address, time; reason for admin actions | Security, misuse investigation | Legitimate interests | 1 year |
| Backups | All of the above | Database dump, stored files | Recovery | Legitimate interests | 28 days (7 daily, 4 weekly, mirrored off-site) |

## 2. Service providers (processors) and locations

Confirm each provider's data location and that a data processing agreement is in place. The
locations below are **to be confirmed**; several may be outside Kenya (cross-border transfer).

| Provider | Role | Data | Location to confirm |
|---|---|---|---|
| VPS host (production) | Runs the app, MySQL, Redis, file storage | Everything | Chosen at deployment |
| Aiven (development; production if used) | Managed MySQL | Everything in the database | The Aiven cloud/region selected |
| Cloudflare R2 (development; production if used) | File storage | Resumes, certificates | R2 "Automatic" location: may be outside Kenya |
| Email provider (SMTP, to be chosen) | Sends emails | Email address, message content | Provider's region |
| Google (only if a user chooses Google sign-in) | Sign-in | Name, email (scopes `openid email profile`) | Google |

Development has so far used test data only; real personal data should not be put into the
development services.

## 3. Security measures (in place)

- HTTPS only in production, HSTS, strict Content Security Policy (`docker/nginx`).
- Passwords hashed with bcrypt (cost 12); refresh tokens stored as SHA-256 hashes and rotated;
  stolen-token reuse revokes all sessions.
- Role-based access on every route plus ownership checks; others' records return 404.
- Files in private buckets, encrypted at rest, served only through 5-minute signed links after an
  access check; uploads checked by content (PDF/DOCX only).
- Rate limits on sign-in and on the whole API.
- Insert-only audit log of sign-ins and admin actions, viewable by admins.
- Production refuses to start with unsafe settings (placeholder secrets, HTTP URLs, no SMTP, no
  privacy contact).
- Data minimisation: Google scope limited to name and email; one strictly necessary cookie; no
  analytics or advertising.

## 4. Data subject rights: how they are handled

| Right | How |
|---|---|
| Be informed | `/privacy`, linked from registration and every page footer |
| Access | Self-service: `/account` → "Download my data" (JSON of everything held: `GET /account/export`) |
| Rectification | Self-service for profile fields; other corrections by request to `PRIVACY_CONTACT_EMAIL` (an admin edits) |
| Erasure | Self-service: `/account` → "Delete my account" (`POST /account/delete`); admins can also delete. Both **anonymise** (`anonymiseUser()`): personal data and files are erased; shared records remain as "Deleted user" |
| Object / restrict | By request to `PRIVACY_CONTACT_EMAIL`; an admin can suspend an account to stop processing while a request is handled |
| Portability | The JSON export is machine-readable |
| Complain | Notice points to the Office of the Data Protection Commissioner |

Keep a simple log of requests received by email (date, request, action, date answered).

## 5. Breach response procedure

1. **Contain:** suspend affected accounts (admin portal), rotate exposed secrets (`.env`, R2 keys,
   database passwords, `JWT_ACCESS_SECRET`: rotating it signs everyone out), restore from backup
   if data was altered.
2. **Assess:** what data, whose, how many people, the risk to them. Sources: the audit log (admin
   portal → Audit log), API logs (`docker compose logs api`), provider dashboards.
3. **Notify the Data Commissioner** when the breach is likely to put people at risk, **within the
   deadline the Act sets (understood to be 72 hours of becoming aware; confirm)**, with what is
   known so far.
4. **Tell affected people** without undue delay when the risk to them is high, with what they
   should do (e.g. change passwords).
5. **Record** every breach, even minor ones: facts, effects, action taken.

## 6. Questions for the reviewer

1. **Registration:** must the operator register with the Office of the Data Protection
   Commissioner as a data controller (and/or processor), given the number of users and the nature
   of the data?
2. **Who is the controller for application data?** Is a company that receives applications an
   independent controller for them (needing its own notice to applicants), or a processor for us?
3. **Legal bases:** are the bases in section 1 right? Is consent needed anywhere (e.g. sharing
   GPA with companies, Google sign-in)?
4. **Cross-border transfers:** which safeguards are needed for providers outside Kenya, and what
   must the notice say about them?
5. **Minors:** can students under 18 use the platform? If so, guardian consent and a different
   notice are needed.
6. **DPIA:** do the applicant filters (skills, university, GPA) amount to profiling that requires
   a data protection impact assessment?
7. **Retention:** are 1 year for inactive accounts and the audit log, 6 months for resumes and 28
   days for backups appropriate? Are there legal retention duties (e.g. for certificates or
   disputes) that call for keeping some records longer?
8. **Response times:** what deadline applies to access, rectification and erasure requests made by
   email, and how should identity be verified for them?
9. **Notice wording:** is `/privacy` complete and in the right language and tone?

## 7. Before launch

- [ ] Review completed; notice and this pack updated with the answers.
- [ ] `DATA_CONTROLLER_NAME` and `PRIVACY_CONTACT_EMAIL` set in the production `.env`.
- [ ] Provider locations confirmed; data processing agreements in place (section 2).
- [ ] Registration with the ODPC done if required.
- [ ] Backups mirrored off-site with `OFFSITE_REMOTE` (docs/DEPLOYMENT.md §7); the 28-day sync is
      what makes erasure reach the backups.
- [ ] A named person monitors `PRIVACY_CONTACT_EMAIL` and knows the breach procedure (section 5).
