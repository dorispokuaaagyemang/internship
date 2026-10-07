# Requirements Traceability — Internship Management Platform

This file maps every user story and non-functional requirement in [ACCEPTANCE.md](../ACCEPTANCE.md) to the parts of [ARCHITECTURE.md](ARCHITECTURE.md) that implement it. Endpoints are relative to `/api/v1`. "Guard" means a rule enforced in a service, middleware or the database. Test files follow `server/tests/integration/<module>.test.js`, and each test names the story ID.

## Module 1: Authentication & Account Security

| Story | Acceptance criterion | Endpoint(s) | Tables | Enforcement / job |
|---|---|---|---|---|
| US-00A | Redirect to Google consent | `GET /auth/google` | — | `integrations/google.js`; signed `state` (intent + nonce) checked against a `google_oauth_nonce` cookie |
| US-00A | Create or log into account | `GET /auth/google/callback` | users | Lookup by google_id, then email, then create |
| US-00A | Link to existing email, no duplicate | `GET /auth/google/callback` | users (`google_id` UK, `email` UK) | Link only when Google reports the email verified. Linking to an unverified account clears its password and sessions. An email already linked to another Google id is refused |
| US-00A | Denied consent fails gracefully | `GET /auth/google/callback` | — | Redirect `/login?error=google_denied`, no insert |
| US-00A | Same role-based access | — | users.role | Role taken from intent in `state`, same JWT claims |
| US-00B | **Dropped 2026-10-06**: no SMS gateway can be used. No OTP is sent or checked | — | — | Accounts activate by email verification (US-01); Google accounts at once |
| US-00B | Validate country code/format (still applies) | `POST /auth/register`, `POST /companies` (`contactPhone`) | users.phone_e164, companies.contact_phone | libphonenumber-js, stored as E.164, not verified |

## Module 2: Student Management

| Story | Acceptance criterion | Endpoint(s) | Tables | Enforcement / job |
|---|---|---|---|---|
| US-01 | Account created + verification email | `POST /auth/register`, `GET /auth/verify-email/:token` | users, email_verification_tokens | `email.send` job (`verifyEmail` template). Single-use link valid for 24 h; `POST /auth/verify-email/resend` sends a new one (one per minute) |
| US-01 | Unverified email blocks login | `POST /auth/login` | users.email_verified_at | Login guard (password accounts), 403 `EMAIL_NOT_VERIFIED` |
| US-01 | Duplicate email rejected | `POST /auth/register` | users (`email` UK) | 409 `EMAIL_TAKEN` |
| US-01 | Password ≥8, number, special char | `POST /auth/register` | — | Joi (`modules/auth/validators.js`) + Zod mirror |
| US-01 | Email verification required before active | `GET /auth/verify-email/:token` | users.status, email_verified_at | Status stays `pending` until the link is used; `requireVerified` returns 403 `EMAIL_NOT_VERIFIED` |
| US-01 | Google registration alternative | `GET /auth/google` | users | See US-00A. Active at once (Google verified the email) |
| US-02 | Resume PDF/DOCX < 5 MB | `POST /students/me/resume` | files, student_profiles.resume_file_id | Multer 5 MB limit (413 `FILE_TOO_LARGE`) + `file-type` magic bytes (415 `UNSUPPORTED_FILE_TYPE`), private bucket encrypted at rest, 5-minute presigned download |
| US-02 | Missing mandatory fields block save | `PUT /students/me` | student_profiles | Joi 422 with `fields`, form highlights them |
| US-02 | Updates reflected + timestamp logged | `PUT /students/me` | student_profiles.updated_at | Sequelize timestamps |
| US-03 | Search keyword/location/domain < 2 s | `GET /postings?q&location&domain&page&limit` | postings | FULLTEXT boolean prefix match (best match first), `location` contains, `domain` exact, max 50 per page; ids are paged first, then loaded with company and skills (MATCH cannot run on the subquery Sequelize builds for includes). About 0.4 s against Aiven |
| US-03 | Profile completeness checked on apply | `POST /postings/:id/apply` | student_profiles | `requireVerified` (verified phone), then service guard: 422 `PROFILE_INCOMPLETE` naming the missing fields; 409 `POSTING_CLOSED` if not active or past the deadline |
| US-03 | Status "Applied" + confirmation | `POST /postings/:id/apply` | applications, application_status_history | `application.created` event → `applicationReceived` email (in-app notification in phase 5) |
| US-03 | Duplicate application prevented | `POST /postings/:id/apply` | applications `UNIQUE(posting_id, student_id)` | 409 `ALREADY_APPLIED` |

## Module 3: Company Management

| Story | Acceptance criterion | Endpoint(s) | Tables | Enforcement / job |
|---|---|---|---|---|
| US-04 | New company → Pending Verification | `POST /companies` | companies.status | `requireVerified` on the route (the rep's email is verified); starts `pending_verification`; `contactPhone` given or the rep's own (format-checked, not verified) |
| US-04 | Admin approval → Verified | `GET /admin/companies?status=`, `POST /admin/companies/:id/approve` | companies.verified_by/verified_at, audit_logs | Admin only; conditional update from `pending_verification` (409 `COMPANY_NOT_PENDING`); audited `admin.company_approved`; rep emailed |
| US-04 | Unverified company cannot post | `POST /postings` | companies.status | `assertCanPost()` in `companies/service.js`: 403 `COMPANY_NOT_VERIFIED` / `COMPANY_SUSPENDED` / `COMPANY_REQUIRED` |
| US-04 | ~~Contact number SMS OTP~~ | — | — | Dropped with US-00B; the number is format-checked only |
| US-04 | Google registration alternative | `GET /auth/google?intent=company` | users | See US-00A |
| US-05 | Create posting as Draft | `POST /postings`, `PUT /postings/:id` | postings, posting_skills | status = draft; `assertCanPost()`; only a draft can be edited (409 `POSTING_NOT_EDITABLE`) |
| US-05 | Publish → Active | `POST /postings/:id/publish` | postings.status, published_at | Conditional update from `draft` (409 `POSTING_NOT_DRAFT`); deadline must be ahead (409 `DEADLINE_PASSED`) |
| US-05 | Auto-close at deadline | `POST /postings/:id/close` (manual) | postings.status, closed_at | `postings.autoClose` on the `maintenance` queue every 5 min (`upsertJobScheduler`); search hides postings past their deadline at once; apply will check the deadline too |
| US-06 | List applications with profile summary | `GET /postings/:id/applications`, `GET /applications/:id`, `GET /applications/:id/resume` | applications, student_profiles | Ownership via `company_members`; other companies get 404; resume as a 5-minute presigned link |
| US-06 | Status update notifies student | `PATCH /applications/:id/status` | applications, application_status_history, notifications | Transition table; conditional update (409 `APPLICATION_CHANGED`); history row with note; `application.statusChanged` → `applicationStatusChanged` email (Socket.IO in phase 5) |
| US-06 | Filter by skills/university/GPA | `GET /postings/:id/applications?skills&university&minGpa` | student_skills, student_profiles | Skills: must have all listed (case-insensitive) via `student_id IN (… HAVING COUNT = n)`; university contains; `gpa >=`; ids paged first, then loaded |

## Module 4: Application Workflow

| Story | Acceptance criterion | Endpoint(s) | Tables | Enforcement / job |
|---|---|---|---|---|
| US-07 | Dashboard updates without refresh | `GET /applications/me`, Socket.IO `/socket.io` | applications, notifications | Socket authenticated with the access token (`auth.token`), joins `user:<id>`; each notification is pushed as a `notification` event (`lib/realtime.js`, Redis adapter); client invalidates its queries |
| US-07 | Notification on status change | `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` | notifications | `application.statusChanged` listener → notification row + live push + `applicationStatusChanged` email |
| US-07 | Restricted status set | `PATCH /applications/:id/status` | applications.status ENUM | Transition table in service |
| US-08 | Withdraw from Applied/Shortlisted, company notified | `POST /applications/:id/withdraw` | applications | `TRANSITIONS` table, 409 `WITHDRAW_NOT_ALLOWED`; `application.withdrawn` → `applicationWithdrawn` email to the company reps |
| US-08 | Withdraw disabled when Accepted/Rejected | `GET /applications/:id` | — | `allowedActions` in response, 409 on attempt |

## Module 5: Supervisor Management

| Story | Acceptance criterion | Endpoint(s) | Tables | Enforcement / job |
|---|---|---|---|---|
| US-09 | Assign supervisor from staff → access | `GET`/`POST /companies/me/staff` (invite by email; `POST /auth/invite/accept` sets the password and activates), `POST /internships/:id/supervisor` | company_members (`member_role = supervisor`, `full_name`), account_invites, supervisor_assignments | Same-company supervisor check; the active supervisor can read the intern's record (`GET /internships/:id`, `/resume`, `/evaluations`); a former one gets 404 |
| US-09 | Both parties notified | `POST /internships/:id/supervisor` | notifications | `supervisor.assigned` event → `supervisor.assigned` (student) and `intern.assigned` (supervisor) notifications + `supervisorAssigned` emails |
| US-09 | 1 supervisor : N interns, 1 active per intern | — | supervisor_assignments `active_key` (VIRTUAL generated, UNIQUE) | Previous assignment ended in the same transaction; a lost race returns 409. VIRTUAL because MySQL forbids a STORED generated column on a cascading FK column |
| US-10 | Evaluation timestamped per intern | `POST /internships/:id/evaluations` | evaluations.created_at | Only the active supervisor (403 `NOT_THE_SUPERVISOR` for other roles), internship ongoing; intern notified (`evaluation.submitted`) |
| US-10 | Visible to student (read-only) and company | `GET /internships/:id/evaluations` | evaluations | No update/delete routes; the model refuses update and destroy in hooks |
| US-10 | Rating 1–5, comments, attendance required | `POST /internships/:id/evaluations` | evaluations `CHECK (rating BETWEEN 1 AND 5)`, NOT NULL, attendance ENUM | Joi (`internships/validators.js`) + DB constraints |
| US-11 | End date passed + final evaluation → PDF | `POST /internships/:id/complete` | internships, evaluations, certificates, files | `certificate.generate` job (PDFKit → S3) |
| US-11 | Stored in profile + download link emailed | `GET /certificates/:id/download` | certificates | `email.send`, presigned URL |
| US-11 | Incomplete evaluation blocks generation | `POST /internships/:id/complete` | — | 422 with validation message |

## Module 6: Admin

| Story | Acceptance criterion | Endpoint(s) | Tables | Enforcement / job |
|---|---|---|---|---|
| US-12 | Dashboard counts | `GET /admin/stats` | users, companies, postings, applications | Grouped COUNT queries, cached 60 s in Redis (`admin:stats`), computed directly if Redis is down |
| US-12 | Suspension removes privileges immediately | `POST /admin/users/:id/suspend` (reason required), `/reinstate`, `DELETE /admin/users/:id`; `POST /admin/companies/:id/suspend`, `/reinstate` | users.status, refresh_tokens, companies.status, postings | Status cache cleared (next request 403), refresh tokens revoked, sockets dropped (`disconnectUser`); a suspended company can't post and its active postings close. Admin accounts can't be changed here |
| US-12 | Admin actions audited | All `/admin/*` mutations; `GET /admin/audit-logs?action&actorId&entityType&entityId&from&to` | audit_logs | `record()` in each service with the admin id, IP and the reason; `AuditLog` refuses update/destroy; viewer filters by exact action or prefix (`admin.`) |

## Non-Functional Requirements

| NFR | Design element |
|---|---|
| Security: sessions | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`: 15-minute JWT + 7-day rotating refresh cookie (hash in `refresh_tokens`). Reusing a rotated token revokes all of the user's sessions (`modules/auth/service.js`) |
| Security: RBAC | `authenticate` + `authorize()` (`middleware/auth.js`) + service ownership checks |
| Security: auth rate limiting | `authLimiter` (`middleware/rate-limit.js`): 20 requests per IP per 15 minutes on register, login and refresh, counted in Redis |
| Security: encrypted resumes/personal data | SeaweedFS volume encryption, disk encryption, TLS, presigned URLs |
| Security: OAuth 2.0 | Authorization-code flow in `integrations/google.js` (no Passport: its `state` check needs server sessions), `openid email profile` scope, ID token `iss`/`aud`/`exp` checked |
| Security: auth rate limiting | Per-IP `express-rate-limit` (Redis store) on the auth endpoints |
| Performance: 2–3 s search/list | FULLTEXT + indexes, pagination, slow work moved to the worker |
| Auditability: admin + auth events | `audit_logs` written for register, login, failed login, logout, refresh-token reuse, email verification, Google sign-in, admin actions |
| ~~Reliability: SMS monitoring + email fallback~~ | Dropped with US-00B |
| Compliance: data protection | Minimal scopes, soft delete + anonymization, encrypted backups |

## Coverage review (2026-10-07)

Every acceptance criterion checked against the implementation, with automated tests (server 282,
client 82) and checks against the real database (Aiven MySQL), storage (Cloudflare R2) and Google.

| Story | Status | Notes |
|---|---|---|
| US-00A Google sign-in | Met | Verified live: new account active at once, Google name kept, existing email linked, denial handled |
| US-00B SMS verification | Dropped (2026-10-06) | No SMS gateway available. Phone numbers are still format-checked (E.164) at registration and for the company contact |
| US-01 Student registration | Met, one deviation | Name, email, password (rules enforced), duplicate email refused, email verification required. **University and department are collected on the profile**, not the registration form; applying is blocked until they are filled in |
| US-02 Profile | Met | PDF/DOCX < 5 MB checked by content; mandatory fields highlighted; `updated_at` on every change |
| US-03 Search and apply | Met | Search ~0.2–0.4 s against Aiven (limit 2 s); completeness gate; Applied + confirmation; duplicates refused by a UNIQUE index |
| US-04 Company verification | Met | Pending Verification → admin approval → Verified; unverified companies can't post |
| US-05 Postings | Met | Draft → Active → auto-closed at the deadline (5-minute job, and checked on apply and search) |
| US-06 Review applications | Met | Profile summaries; status changes notify the student; filters on skills (all), university, GPA |
| US-07 Status tracking | Met | Live over Socket.IO, in-app + email notifications; closed status set enforced by the transition table |
| US-08 Withdraw | Met | Only from Applied/Shortlisted; company notified; button absent otherwise |
| US-09 Supervisor | Met | Staff invited by email; one active supervisor per intern enforced by a UNIQUE generated column; both notified |
| US-10 Evaluations | Met | Rating 1–5 (CHECK constraint), comments, attendance; timestamped; append-only; read-only for students |
| US-11 Certificate | Met | Blocked with a message until the end date passed and a final evaluation exists; PDF generated, stored (R2), emailed link; verified live |
| US-12 Admin | Met | Counts; suspension takes effect on the next request (verified: 200 → 403); all admin actions audited with reason |

**Non-functional requirements**

| Requirement | Status | Notes |
|---|---|---|
| RBAC | Met | `authorize()` per route plus ownership checks in services (404 for others' records) |
| Encrypted storage | Met for files; database depends on hosting | Files encrypted at rest (R2 always; SeaweedFS `-s3.encryptVolumeData`). Aiven encrypts the database at rest; a self-hosted MySQL on the VPS needs disk encryption (DEPLOYMENT.md) |
| OAuth 2.0 | Met | Authorization-code flow with signed state and nonce |
| Rate limiting | Met | Auth endpoints 20 / 15 min per IP; whole API 600 / 5 min per IP (Redis-backed) |
| Performance 2–3 s | Met in measurements | Search ~0.4 s, lists well under 1 s against a remote database; no load test has been run |
| Auditability | Met | Admin actions and auth events in an insert-only audit log, viewable by admins |
| Reliability (SMS) | Dropped | With US-00B |
| Compliance (Kenya DPA 2019 / GDPR) | Met (pending legal review) | Access: `GET /account/export` (JSON of everything held). Erasure: `POST /account/delete` and admin delete both anonymise (`privacy/service.js anonymiseUser`): personal data and files go, shared records stay as "Deleted user". Retention (daily `privacy.retention`): 1 year inactive → anonymised after a 30-day email warning; resumes after ~6 months inactive; unverified accounts after 30 days; audit log after 1 year. Privacy notice at `/privacy` with values from `GET /account/privacy-info`. Minimisation: Google scope `openid email profile`, one strictly necessary cookie |

**Open items**
- Legal review of data protection: docs/DATA-PROTECTION.md is the reviewer's pack (record of processing, processors, breach procedure, open questions).
- The production nginx/HTTPS configuration and `backup.sh` have not been run yet (no Docker on the development machine); do the checklist in DEPLOYMENT.md on a staging server first.
- Implementation notes ask for use-case diagrams per story; the architecture has context, container, sequence and state diagrams, but no per-story use-case diagrams.
- No load test: run one before launch if many concurrent users are expected.
