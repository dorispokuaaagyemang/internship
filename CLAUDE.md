# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Roadmap phases 1-5 are done on the server, and the client covers them:
- Phase 1, scaffold: npm workspaces `client/` and `server/`, health endpoint, Docker Compose, CI.
- Phase 2, auth: register, login, refresh rotation, logout, `GET /auth/me`, email verification, Google sign-in, audit log, the BullMQ worker. **SMS OTP (US-00B) was dropped on 2026-10-06**: an SMS gateway can't be used. Password accounts activate on email verification; Google accounts are active at once. Phone numbers are collected and format-checked only. Don't reintroduce phone verification.
- Phase 3: student profile and resume upload (`modules/students`, `files`), company registration and admin approval (`modules/companies`, `modules/admin`, `npm run admin:create -w server -- <email>`).
- Phase 4: postings with search and auto-close (`modules/postings`, `maintenance` queue), applications with the `TRANSITIONS` table (`modules/applications`).
- Phase 5: notifications table, `lib/events.js` domain events, Socket.IO (`lib/realtime.js`).
- Client: auth pages, guards, notification bell; student, company, supervisor and admin portals, each lazy-loaded.
- Phase 6 (supervision) is done. Server: staff invites (`/companies/me/staff`, `account_invites`, `/auth/invite/*`; an invited supervisor activates by setting a password through the emailed link), internships created on Accept (`lib/dates.js`, DATEONLY 'YYYY-MM-DD'), `modules/internships` (role-aware access, dates, supervisor assignment with the VIRTUAL `active_key`, append-only evaluations, completion), certificates (`integrations/pdf.js`, `certificates` queue, idempotent `generateCertificate()`, 10-minute sweep). Client: `/accept-invite/:token`, `features/internships` (one `InternshipPage` for student/company/supervisor via `viewerRole`, `StaffPage`), routes `/my-internships`, `/company/interns`, `/company/staff`, `/supervisor`.
- Phase 7 (admin, US-12) slice 1 is done: `modules/admin` (`getStats()` cached 60 s, user search, suspend/reinstate/delete with a required reason, audit-log viewer), company suspend/reinstate in `companies/service.js`; client admin portal at `/admin`, `/admin/companies`, `/admin/users`, `/admin/audit`. Slice 2 (hardening and deployment) is done: production config checks (`productionProblems()`, opt-out `ALLOW_INSECURE_PRODUCTION` for the local Docker stack), API-wide rate limit, `modules/maintenance` (daily cleanup, internship-ended reminder), nginx security headers and HTTPS (`docker/nginx/*`, `docker/docker-compose.prod.yml`), `docker/backup.sh`, `docs/DEPLOYMENT.md`, `users.display_name`, and the coverage review at the end of docs/TRACEABILITY.md. The roadmap is complete; open items are listed there.
- The platform serves **Ghana**: data protection under the Data Protection Act, 2012 (Act 843), regulator the Data Protection Commission; stipends default to GHS; examples use +233 numbers and Ghanaian places.
- Data protection (Ghana DPA 2012 / GDPR) is done: `modules/privacy` (`anonymiseUser()` is THE way to erase a person: self-service `POST /account/delete`, admin delete and retention all use it; `exportUserData()`; `applyRetention()` daily: 1 year inactive with a 30-day warning, resumes ~6 months, unverified 30 days, audit log 1 year). Erased users are soft-deleted with `anonymised_at`; code that includes a membership's `user` must cope with it being null. Client `/account` and `/privacy`.

## Production checklist

Things that differ from local dev and must be done before going live. The full procedure is docs/DEPLOYMENT.md:
- **Google sign-in:** in Google Cloud Console, replace the localhost entries on the OAuth client. Authorized JavaScript origin: the public URL (e.g. `https://<domain>`); authorized redirect URI: `https://<domain>/api/v1/auth/google/callback` (it must equal `APP_URL` + `/api/v1/auth/google/callback`, or `GOOGLE_CALLBACK_URL` if set). Move the consent screen from Testing to In production so any Google account can sign in, not only test users.
- **URLs and cookies:** set `APP_URL` and `CORS_ORIGIN` to the public HTTPS URL; leave `COOKIE_SECURE` at its production default (true).
- **Email:** set `SMTP_*` and `MAIL_FROM`; without `SMTP_HOST` emails are only logged.
- **Data protection:** set `DATA_CONTROLLER_NAME` and `PRIVACY_CONTACT_EMAIL`; have docs/DATA-PROTECTION.md reviewed; run backups with `OFFSITE_REMOTE` (28-day sync, so erasure reaches backups).
- **Secrets:** a new `JWT_ACCESS_SECRET`; production R2 keys (or SeaweedFS) and buckets; production database credentials.

## Commands

Run from the repo root. Copy `.env.example` to `.env` first. There is one `.env` at the root, used by the API locally and by compose.

- `npm run dev:server`: starts the API on :4000 (`node --watch`). `npm run dev:client` starts Vite on :5173, which proxies `/api` and `/socket.io` to :4000. `npm run dev:worker` runs the queue worker; it needs Redis.
- `npm run lint`, `npm test`, `npm run build`: run across both workspaces (CI runs these on Node 24).
- Vitest runs at most 2 workers outside CI (`maxWorkers` in both configs): the dev machine has 6 GB and the API, worker and Vite usually run alongside. A "Worker exited unexpectedly" error means memory ran out, not a failing test.
- Single server test: `npm test -w server -- tests/integration/health.test.js`, or `-t "<name>"`.
- Single client test: `npm test -w client -- src/features/system/SystemStatus.test.jsx`
- Migrations: `npm run db:migrate -w server` (also `db:migrate:undo`, `db:seed`). The API container runs `db:migrate` on start.
- Demo data: `npm run db:seed:demo -w server` (`-- --reset` to recreate it, `-- --remove` to delete it). The script is `server/scripts/seed-demo.js`, and it refuses to run in production. It adds Ghanaian companies, students, postings, applications and internships at every stage, and issues one certificate. Every demo account is `<name>@demo.example.com` with password `Demo@2026` (or `DEMO_PASSWORD`), e.g. `admin@`, `kwame.asante@` (rep), `efua.owusu@` (supervisor), `ama.mensah@` (student). Demo companies have `DEMO-` registration numbers. `--remove` deletes only those accounts and companies.
- Hosted services instead of `infra:up`: MySQL on Aiven (set `DB_SSL_CA` to its `ca.pem`, kept in the gitignored `certs/`), Redis on Upstash (a `rediss://` URL in `REDIS_URL`).
- `npm run infra:up`: starts only MySQL, Redis, SeaweedFS and Mailpit in Docker, with host ports exposed, for local dev. Mailpit catches email on SMTP :1025 and shows it at http://localhost:8025. `npm run docker:up` / `docker:down` runs the full stack behind nginx on :80. The compose files (`docker-compose.yml`, plus `docker-compose.dev.yml` for host ports) and the nginx image live in `docker/`.

**Server notes:**
- Config is validated with Joi in `server/src/config`. A missing variable fails startup with a list of every problem. Add each new variable there and in `.env.example`.
- Server tests run on Vitest (`server/vitest.config.js`) and set their environment in `server/tests/setup-env.js`. Integration tests `vi.mock` `src/db/index.js`, `src/lib/redis.js` and `src/lib/s3.js`. Modules with a default export are mocked as `{ default: ... }`.
- `GET /api/v1/health` returns 200 or 503 with a per-dependency report (mysql, redis, storage).
- Both workspaces are ES modules (`"type": "module"`). Relative imports need the `.js` extension (`import { config } from './config/index.js'`). The server runs Express 5, so a rejected promise in an async handler reaches the error middleware without try/catch. `server/.sequelizerc` stays CommonJS, because sequelize-cli `require()`s it.
- `createApp()` (`src/app.js`) builds the app without listening, and Supertest uses it directly. `src/server.js` is the process entry point. Mount each new module's router in `src/routes.js`, under `/api/v1`.
- Errors: services throw `AppError(status, code, message, fields?)` (`src/lib/errors.js`). `middleware/error.js` renders every error as `{ error: { code, message, fields? } }`, and an unknown error becomes a 500 `INTERNAL_ERROR`. Every response carries an `x-request-id` header.
- Migrations are CommonJS `.cjs` files, because sequelize-cli loads them with `require()`. Models are ESM: each file exports `initX(sequelize)`, and `src/db/models/index.js` initialises them and wires associations, so import models from there. Tokens are stored as SHA-256 hex (`CHAR(64)`). `AuditLog` rejects update and destroy in its hooks.
- Auth: protect a route with `authenticate` from `middleware/auth.js`, then `authorize('admin', ...)` if it needs a role. Add `requireVerified` to anything beyond auth (applying, posting, ...): pending accounts can sign in, and it returns 403 `PHONE_NOT_VERIFIED` / `EMAIL_NOT_VERIFIED`. It sets `req.user = { id, role, status }`. Call `invalidateUserStatus(id)` after changing a user's status.
- Validate a request body with `validate(joiSchema)` (`middleware/validate.js`), or the query string with `validate(joiSchema, 'query')`. A failure returns 422 `VALIDATION_ERROR` with `fields`.
- The refresh token is an httpOnly cookie scoped to `/api/v1/auth`.
- Redis calls in the request path go through `withTimeout()` (`src/lib/timeout.js`). With Redis down, ioredis holds a command for over a minute. When the timeout fires, the status cache falls back to the DB and the rate limiter lets the request through.
- Realtime: `src/server.js` calls `initRealtime(server)`; a socket authenticates with the access token in `auth.token`. Outside the API process (tests, worker) `pushToUser()` is a no-op.
- Domain events: services `await emit('application.statusChanged', …)` from `lib/events.js` after the transaction commits; listeners live in `modules/notifications/listeners.js` (imported once by `app.js`) and never fail the request.
- Queues: services call helpers in `src/jobs/queues.js` (e.g. `enqueueEmail(template, to, data)`). They time out after 1 s if Redis is down. The worker runs the processors in `src/jobs/processors/`, and external services sit behind adapters in `src/integrations/`. Email templates live in `jobs/processors/email-templates.js`. Repeatable jobs are listed in `SCHEDULES` in `jobs/processors/maintenance.js`; the worker upserts them at startup. Without `SMTP_HOST`, emails are written to the worker log. If an email can't be queued outside production, the API logs the link instead. Queue only after the transaction commits.
- Tests that call `createApp()` must also `vi.mock` `src/db/models/index.js`, because the auth routes import the models.
- Sequelize is configured with `underscored: true`, timestamps and UTC (`src/db/index.js`). `.sequelizerc` points the CLI at `src/db/{migrations,models,seeders}`.
- The compose SeaweedFS service creates the private buckets `resumes` and `certificates` (names from `S3_BUCKET_RESUMES`/`S3_BUCKET_CERTIFICATES`). Locally the user runs Cloudflare R2 instead, with those buckets made by hand. Uploads check the type from the bytes with `file-type`, never the name or Content-Type.

**Client notes:**
- Every request goes through the axios instance in `client/src/lib/api.js` (`baseURL: '/api/v1'`, with cookies). It is same-origin everywhere: Vite proxies in dev, and nginx proxies in production.
- Routes live in `client/src/routes/AppRoutes.jsx`, nested `RequireAuth` > `RequireActive` (pending accounts go to `/verify`) > `RequireRole`. Feature code lives in `client/src/features/<feature>/`; add nav links per role in `components/Layout.jsx`.
- Session: the access token is only in memory (`lib/api.js`); the refresh cookie restores it on load. Always renew through `refreshSession()`: it is single-flight, because the server revokes every session when a refresh token is used twice. `useAuth()` (from `features/auth/auth-context.js`) gives `user`, `login`, `logout`, `setUser`, `reloadUser`.
- Forms: React Hook Form + Zod (schemas mirror the server's Joi rules); `applyServerErrors()` (`lib/forms.js`) puts API `fields` onto the form. Shared UI (`Field`, `Button`, `Alert`, `Card`, `StatusBadge`) is in `components/ui.jsx`.
- Tests render pages with `renderApp()` from `src/test/render.jsx` (router, query client, a given auth state) and mock `lib/api` keeping `apiError`.

## Key documents

- [ACCEPTANCE.md](ACCEPTANCE.md): user stories and acceptance criteria. This is the source of truth for behavior.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the approved system design, covering containers, data model, auth flows, state machines, API surface, jobs, deployment and roadmap.
- [docs/DATA-PROTECTION.md](docs/DATA-PROTECTION.md): reviewer's pack for Ghana's Data Protection Act, 2012 (Act 843) / GDPR (record of processing, processors, breach procedure, open legal questions). Keep it in step with `modules/privacy`.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production on a VPS (env, HTTPS, Google OAuth, backups, updates).
- [docs/EMAIL.md](docs/EMAIL.md): SMTP setup (Brevo or Gmail); `npm run mail:test -w server -- <address>` checks it. Reserved test domains (`example.com`, `.invalid`, ...) are never mailed, only logged.
- [docs/DEPLOY-RENDER-VERCEL.md](docs/DEPLOY-RENDER-VERCEL.md): the chosen hosting: the API on Render (`render.yaml`: workers in-process with `RUN_WORKER_IN_API`, migrations as the pre-deploy command, Key Value for Redis) and the web app on Vercel (`client/vercel.json` forwards `/api` with an `x-origin-secret` header, so the refresh cookie stays first-party). With `ORIGIN_SECRET` set, `middleware/origin.js` refuses `/api` requests without the secret and takes `req.ip` from Vercel's `X-Real-IP`. Socket.IO connects to Render directly (`VITE_SOCKET_URL`), because Vercel can't proxy WebSockets.
- [docs/TRACEABILITY.md](docs/TRACEABILITY.md): maps each acceptance criterion to its endpoints, tables and enforcement. Keep it updated when the design changes.

Cite story IDs (e.g. `US-00B`, `US-07`) in code, test names and commits.

## Chosen stack

- **Frontend:** React (Vite), React Router, TanStack Query, React Hook Form + Zod (planned, not yet installed). One responsive SPA serves four role portals.
- **Backend:** Express.js (Node 24) with the Sequelize ORM on MySQL 8. A modular monolith (`server/src/modules/<module>/{routes,controller,service,validators}.js`), plus a separate BullMQ **worker** process from the same image.
- **Infrastructure:** Docker Compose on a single VPS: nginx, api, worker, mysql, redis, seaweedfs.
- **Integrations:**
  - Email: Nodemailer over SMTP
  - Sign-in: Google OAuth 2.0 / OpenID Connect, implemented directly in `server/src/integrations/google.js` (not Passport, whose `state` check needs server sessions)
  - Certificates: PDFKit
  - File storage: SeaweedFS, accessed through `@aws-sdk/client-s3` (`server/src/lib/s3.js`), so any S3-compatible service can replace it. MinIO was dropped because it no longer publishes free binaries
- **Tests:** Vitest on both workspaces: with Supertest on the server, and with React Testing Library on the client.

**Design rules to preserve:**
- Business rules and state-transition guards belong in services. Controllers stay thin.
- Slow or external work (email, PDF) always goes through a queue.
- Domain events drive notifications (a Socket.IO room `user:<id>` plus email).
- Requirement invariants are backed by DB constraints, e.g. `UNIQUE(posting_id, student_id)` and the generated `active_key` for one active supervisor per intern.

## Domain model (cross-cutting rules from ACCEPTANCE.md)

**Roles:** Student, Company representative, Supervisor (company staff), Admin. Access is enforced via RBAC.

**Authentication (Module 1):** A password account becomes active once its email is verified; a Google account is active at once. SMS OTP verification (US-00B) was dropped: no SMS gateway is available. A company rep must be active before registering the company, which then enters "Pending Verification".
- Google sign-in links to an existing account with the same email instead of creating a duplicate, and grants the same role-based access.
- Phone numbers (registration, company contact) are validated for country code and format and stored as E.164, but not verified.
- Email/password registration also requires email verification. Passwords need at least 8 characters, one number, and one special character.

**State machines:**
- Company account: `Pending Verification` → `Verified` (admin approval). Only verified companies can post.
- Posting: `Draft` → `Active` (publish) → auto-closed when the deadline passes.
- Application: `Applied`, `Shortlisted`, `Interviewed`, `Accepted`, `Rejected`, `Withdrawn`. This is a closed set. Students can withdraw only from `Applied` or `Shortlisted`. Only one application per student per posting.
- An account suspended by an admin loses login, posting, and application privileges immediately.

**Gating checks:**
- Applying requires a complete profile (name, university, department) and a verified phone.
- A certificate PDF (US-11) requires both the internship end date to have passed and a submitted final evaluation.

**Relationships:** A supervisor can have many interns. An intern has exactly one *active* supervisor, assigned only after acceptance.

**Side effects:** Status changes (application status, withdrawal, supervisor assignment) trigger notifications (email/in-app) to the affected party.

**Constraints:**
- Resumes: PDF/DOCX only, under 5MB, stored encrypted.
- Evaluations: rating 1–5, comments, and attendance status are all required. Evaluations are timestamped and read-only for students.
- Search/list responses: within 2–3 seconds.

**Audit logging:** Every admin action (approve/suspend/delete) and every auth event (login, email verification, Google sign-in) is logged with actor ID and timestamp.

**Integrations:** Google Identity Services (OAuth 2.0), SMTP email, and PDF generation for certificates.
