# Deployment

How to run the platform in production on a single VPS with Docker Compose (ARCHITECTURE.md §1.2,
§11). Everything runs in containers: nginx (HTTPS, the React app, reverse proxy), the API, the
worker, MySQL, Redis and SeaweedFS (S3-compatible file storage).

Local development is different (Aiven, Memurai, Cloudflare R2, no Docker); see CLAUDE.md.
**Never copy your local `.env` to the server.** Production needs its own, described below.

## 1. Server

- A VPS with Ubuntu 24.04 LTS, at least 2 vCPU, 4 GB RAM and 40 GB disk.
- A domain name with an **A record** pointing at the server's IP (e.g. `internships.example.com`).
- Firewall: allow only SSH (22), HTTP (80) and HTTPS (443). MySQL, Redis and SeaweedFS are not
  published; only nginx is.
- Docker Engine and the Compose plugin: https://docs.docker.com/engine/install/ubuntu/

```sh
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
sudo git clone <your repository URL> /opt/internship
cd /opt/internship
```

## 2. Production `.env`

Create `/opt/internship/.env` from `.env.example` and change at least the values below. The API
**refuses to start** in production when a setting is unsafe (placeholder secret, `http://` or
localhost URL, no SMTP, insecure cookies), and lists every problem at once in its log.

Generate secrets with: `openssl rand -base64 48`

| Variable | Production value |
|---|---|
| `DOMAIN` | `internships.example.com` (used by nginx and the certificate) |
| `CORS_ORIGIN`, `APP_URL` | `https://internships.example.com` |
| `JWT_ACCESS_SECRET` | a new random secret (48+ characters) |
| `COOKIE_SECURE` | leave unset (defaults to `true` in production) |
| `DB_NAME`, `DB_USER` | e.g. `internship` |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD` | two different random secrets |
| `DB_SSL_CA` | empty (the bundled MySQL is on the internal Docker network) |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | random values; Compose gives them to SeaweedFS and the API |
| `S3_REGION` | `us-east-1` (SeaweedFS ignores it) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | your mail provider (required: accounts are activated by email) |
| `MAIL_FROM` | e.g. `Internship Platform <no-reply@internships.example.com>` |
| `DATA_CONTROLLER_NAME` | the organisation legally responsible for the data, e.g. `Example Internships Ltd` (required) |
| `PRIVACY_CONTACT_EMAIL` | where people send data-protection requests; shown on the privacy page (required) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | see section 5 (leave empty to turn Google sign-in off) |

`DB_HOST`, `REDIS_URL` and `S3_ENDPOINT` are set by Compose to the internal services; values in
`.env` for them are ignored. `chmod 600 .env` so only root can read it.

## 3. First HTTPS certificate

nginx needs a certificate before it can start on 443, so the first one is requested with certbot's
own temporary web server, before nginx runs:

```sh
cd /opt/internship
C="docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml"
$C run --rm -p 80:80 --entrypoint certbot certbot certonly --standalone \
  -d internships.example.com -m you@example.com --agree-tos --no-eff-email
```

The certificate lands in `docker/certbot/conf` (not in git).

## 4. Start

```sh
$C up -d --build
$C ps                                   # all services "healthy" / "running"
curl -s https://internships.example.com/api/v1/health   # {"status":"ok",...}
```

The API container runs pending database migrations on every start. The worker starts after the
API is healthy and schedules its repeatable jobs (posting auto-close, certificate sweep, internship
end reminders, nightly cleanup).

Create the first admin (prints a generated password once):

```sh
$C exec api node scripts/create-admin.js admin@example.com
```

## 5. Google sign-in (production)

In Google Cloud Console, on the OAuth client used for production:

1. **Authorized JavaScript origins:** replace `http://localhost:5173` with `https://internships.example.com`.
2. **Authorized redirect URIs:** replace the localhost one with
   `https://internships.example.com/api/v1/auth/google/callback`. It must equal `APP_URL` +
   `/api/v1/auth/google/callback` exactly (or `GOOGLE_CALLBACK_URL` if you set it).
3. **OAuth consent screen / Audience:** move the app from **Testing** to **In production**.
   While in Testing, only the listed test users can sign in.

Many teams keep a separate OAuth client for development, so localhost keeps working locally.

## 6. Certificate renewal

Let's Encrypt certificates last 90 days. Renew from the host twice a day; nginx reloads to pick up
a new one:

```cron
17 3,15 * * * cd /opt/internship && docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml run --rm certbot renew --webroot -w /var/www/certbot --quiet && docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml exec nginx nginx -s reload
```

## 7. Backups

`docker/backup.sh` dumps the database and archives the stored files (resumes, certificates) into
`/var/backups/internship`, keeping 7 daily and 4 weekly copies:

**Off-site copy (required):** a backup on the same disk is lost with it. Configure an rclone remote
once (e.g. a private Cloudflare R2 bucket `internship-backups`, separate from the app's buckets):

```sh
docker run --rm -it -v /root/.config/rclone:/config/rclone rclone/rclone:1.68 config
```

Then schedule the backup with `OFFSITE_REMOTE` set. The script *syncs* the local folder, so backups
deleted locally after 28 days are deleted off-site too; that is what makes an erased account leave
every backup (docs/DATA-PROTECTION.md):

```cron
30 2 * * * OFFSITE_REMOTE=r2:internship-backups /opt/internship/docker/backup.sh >> /var/log/internship-backup.log 2>&1
```

Test a restore now and then:

```sh
# Database (into the running mysql container)
gunzip -c /var/backups/internship/daily/db-<stamp>.sql.gz | \
  $C exec -T mysql sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'

# Files (stop the stack first so nothing writes meanwhile)
$C stop api worker seaweedfs
docker run --rm -v internship_seaweedfs-data:/data -v /var/backups/internship/daily:/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/files-<stamp>.tar.gz -C /data'
$C up -d
```

The audit log is part of the database dump; nothing in the app deletes audit entries.

## 8. Updates

```sh
cd /opt/internship
git pull
$C up -d --build        # rebuilds images; the API applies new migrations on start
$C image prune -f
```

Users stay signed in across a deploy (sessions are JWTs plus refresh cookies in the database).

## 9. Logs and monitoring

- Logs: `$C logs -f api worker` (structured JSON from pino, one line per request with a request id).
- Health: `https://<domain>/api/v1/health` reports MySQL, Redis and storage; Docker restarts the
  API when it stays unhealthy. Point an uptime monitor at it.
- The admin portal shows platform counts, system status and the audit log.

## 10. Using hosted services instead

The design runs MySQL and SeaweedFS on the VPS. To use hosted ones (as in local development:
Aiven MySQL, Cloudflare R2), in `docker/docker-compose.yml` remove the `DB_HOST`/`DB_PORT` and
`S3_ENDPOINT` lines from the `api` and `worker` services and the `mysql`/`seaweedfs` services and
their `depends_on` entries; then set those values in `.env` (with `DB_SSL_CA` pointing at a CA file
mounted into the containers, and `S3_REGION=auto` for R2). Back up through the provider instead of
`backup.sh`.

## Production checklist

- [ ] DNS A record points at the server; ports 80/443 open, nothing else but SSH.
- [ ] `.env` created from `.env.example` with production values (section 2); `chmod 600 .env`.
- [ ] First certificate issued (section 3); renewal cron installed (section 6).
- [ ] `$C up -d --build`; health check returns `ok`.
- [ ] Admin account created.
- [ ] Google OAuth client updated to the real domain and published (section 5).
- [ ] Test email: register a test account and receive the verification email.
- [ ] Backup cron installed, off-site copy configured, one restore tested (section 7).
- [ ] Data protection: docs/DATA-PROTECTION.md reviewed by someone qualified and its "Before launch" list done; `DATA_CONTROLLER_NAME` and `PRIVACY_CONTACT_EMAIL` set; `OFFSITE_REMOTE` set so backups (and erasure) reach off-site copies.
