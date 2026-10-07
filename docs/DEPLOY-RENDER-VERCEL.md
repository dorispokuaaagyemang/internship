# Deploying on Render (API) and Vercel (web app)

An alternative to the single VPS in [DEPLOYMENT.md](DEPLOYMENT.md), with no server to maintain.

```
Browser ──► https://<app>.vercel.app ──┬─ /, /company/...  React app (Vercel)
                                       └─ /api/*  ──► https://<api>.onrender.com  (Render, + x-origin-secret)
        ──► wss://<api>.onrender.com/socket.io      live notifications (direct; Vercel can't proxy WebSockets)

Render: API + queue workers in one process, Redis (Key Value)
Aiven: MySQL            Cloudflare R2: resumes, certificates            SMTP provider: email
```

**Why the API goes through Vercel:** the refresh token is an httpOnly cookie. If the browser
called `onrender.com` directly from `vercel.app`, the cookie would be third-party, and Safari (and
increasingly Chrome) blocks those, so users would be signed out on every reload. Through the
rewrite, everything the browser sees is on one site.

**Why the secret header:** Vercel replaces `X-Real-IP` with the visitor's address, which the API
uses for rate limits and the audit log. With `ORIGIN_SECRET` set, the API refuses `/api` requests
that lack the secret (`403 DIRECT_ACCESS_FORBIDDEN`), so no one can bypass Vercel and fake their IP.
Only `/api/v1/health` stays open, for Render's health check.

## Cost

| Service | Plan | Monthly |
|---|---|---|
| Vercel | Hobby (non-commercial use only; Pro for a business) | $0 |
| Render web service | Free (sleeps after 15 idle minutes, ~1 minute to wake) / Starter | $0 / ~$7 |
| Render Key Value | Free (25 MB, not persisted) | $0 |
| Aiven MySQL, Cloudflare R2 | Free tiers | $0 |

While the free web service sleeps, scheduled jobs (posting auto-close, certificates, reminders,
retention) wait until the next request wakes it. Use Starter for real users.

## 1. Before you start

- The code is on GitHub (or GitLab), and both Render and Vercel can read the repository.
- A **production** Aiven MySQL service (not the development one), with its `ca.pem`.
- **Production** R2 buckets `resumes` and `certificates`, and an R2 API token for them.
- An SMTP account (e.g. Brevo's free plan) with a verified sender address.
- One random secret, for `ORIGIN_SECRET`:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 2. Render (API)

1. Render dashboard → **New → Blueprint** → choose the repository. Render reads `render.yaml` and
   creates `internship-api` and `internship-redis` in Frankfurt.
2. It asks for each `sync: false` variable:
   - `ORIGIN_SECRET`: the secret from step 1.
   - `APP_URL` and `CORS_ORIGIN`: the Vercel URL, e.g. `https://internship.vercel.app`. If you
     don't know it yet, enter a placeholder and change both after step 3.
   - `DB_*`: from the Aiven service. `DB_SSL_CA`: paste the whole content of `ca.pem`.
   - `S3_ENDPOINT`: `https://<account-id>.r2.cloudflarestorage.com`; `S3_ACCESS_KEY` and
     `S3_SECRET_KEY` from the R2 token.
   - `GOOGLE_*`, `SMTP_*`, `MAIL_FROM`, `DATA_CONTROLLER_NAME`, `PRIVACY_CONTACT_EMAIL`.
3. The first deploy runs the migrations (`preDeployCommand`), then starts the API. The API refuses
   to start in production with unsafe settings and lists every problem in the deploy log.
4. Note the service URL, e.g. `https://internship-api.onrender.com`. Check
   `https://internship-api.onrender.com/api/v1/health` reports mysql, redis and storage `up`.
5. Create the first admin: service → **Shell** → `npm run admin:create -w server -- you@example.com`
   (the free plan has no shell: run the same command on your computer with a `.env` pointing at
   the production database).

## 3. Vercel (web app)

1. Vercel dashboard → **Add New → Project** → import the repository.
2. **Root Directory:** `client`. Framework preset: **Vite** (build `npm run build`, output `dist`).
3. **Environment variables** (Production):
   - `API_ORIGIN` = `https://internship-api.onrender.com` (no trailing slash)
   - `ORIGIN_SECRET` = the same secret as on Render
   - `VITE_SOCKET_URL` = `https://internship-api.onrender.com`
4. Deploy. Then, on Render, set `APP_URL` and `CORS_ORIGIN` to the final Vercel URL if they were
   placeholders (Render redeploys by itself).

`client/vercel.json` does the rest: `/api/*` goes to `API_ORIGIN` with the secret header, every
other path gets `index.html` (so links like `/company/interns` work), and the security headers are
set on every page.

## 4. Google sign-in

Google Cloud Console → APIs & Services → Credentials → the OAuth client:
- Authorized JavaScript origin: `https://<app>.vercel.app`
- Authorized redirect URI: `https://<app>.vercel.app/api/v1/auth/google/callback`
- OAuth consent screen: **Publish app** (from Testing to In production).

## 5. Check it works

1. Open the Vercel URL, register, and confirm the email arrives (it activates the account).
2. Sign in, reload the page: you stay signed in (the cookie works).
3. Admin portal → Audit log: your sign-in shows **your** IP address, not one of Vercel's. If it
   shows a Vercel or Render address, the IP setup is wrong: stop and fix it, because rate limits
   would otherwise count everyone together.
4. `curl https://internship-api.onrender.com/api/v1/postings` returns 403 `DIRECT_ACCESS_FORBIDDEN`.
5. Upload a resume close to the 5 MB limit. If the upload fails at the proxy, report it: uploads
   would then need to go to Render directly.
6. As a student, open a page in two tabs, and change an application's status from the company
   account: the student's page updates without a reload (live notifications reach Render directly).

## 6. Updates and backups

- Pushing to the main branch redeploys both (Render runs the migrations before switching over).
- Backups: Aiven's free plan keeps its own short backups; `docker/backup.sh` does not apply here.
  Before real users arrive, check Aiven's backup retention against docs/DATA-PROTECTION.md
  (backups are kept for at most 28 days), and turn on R2 bucket versioning or a scheduled copy if
  needed.
- Data protection: Render (Frankfurt), Vercel, Aiven and R2 all process data outside Ghana. List
  them in section 2 of docs/DATA-PROTECTION.md for the reviewer.
