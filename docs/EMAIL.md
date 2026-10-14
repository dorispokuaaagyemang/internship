# Email (SMTP)

The platform sends email for account activation, staff invites, application updates, supervisor
assignment, certificates and retention warnings. The worker sends it through any SMTP server
(`server/src/integrations/email.js`). Without `SMTP_HOST`, emails are only written to the log, and
production refuses to start without it, because accounts are activated by email.

## Settings

| Variable | Meaning |
|---|---|
| `SMTP_HOST` | The provider's SMTP server |
| `SMTP_PORT` | `587` (with `SMTP_SECURE=false`, upgraded to TLS) or `465` (with `SMTP_SECURE=true`) |
| `SMTP_SECURE` | `false` for 587, `true` for 465 |
| `SMTP_USER`, `SMTP_PASSWORD` | The SMTP login: an SMTP key or app password, never your normal password |
| `MAIL_FROM` | The sender, e.g. `Internship Platform <noreply@yourdomain.com.gh>`. Must be an address the provider has verified |

Test them with `npm run mail:test -w server -- you@example.com`. It checks the login and sends
one email.

## Option A: Resend (recommended, free 3,000 emails a month, 100 a day)

1. Sign up at resend.com.
2. **Domains → Add Domain**: enter your domain (e.g. `devpokuaa.com`, or a subdomain such as
   `mail.devpokuaa.com`). Add the DNS records Resend shows (DKIM, SPF/MX, and optionally DMARC) at
   your DNS provider, then click **Verify**. Resend only sends from a verified domain; its shared
   `onboarding@resend.dev` sender can only mail your own Resend account address.
3. **API Keys → Create API Key** with "Sending access" (shown once). It is the SMTP password.
4. In `.env` (locally) or the Render settings (production):
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=2587
   SMTP_SECURE=false
   SMTP_USER=resend
   SMTP_PASSWORD=<the API key, re_...>
   MAIL_FROM=Internship Platform <noreply@devpokuaa.com>
   ```

`SMTP_USER` is literally the word `resend`. Port `2587` (or `2465` with `SMTP_SECURE=true`) is used
instead of 587/465 because Render's free instances block outgoing traffic on the standard SMTP
ports 25, 465 and 587; Resend accepts the same connection on 2587/2465. On a paid Render plan or a
VPS, 587 also works. `MAIL_FROM` must use the domain verified in step 2.

## Option B: Gmail (quickest to try, about 500 emails a day)

Good for development and a small pilot; it sends as your Gmail address.

1. The Google account needs **2-Step Verification** turned on.
2. myaccount.google.com → Security → **App passwords** → create one named "Internship Platform".
   Copy the 16-character password (shown once).
3. Settings:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=<your Gmail address>
   SMTP_PASSWORD=<the app password, without spaces>
   MAIL_FROM=Internship Platform <your Gmail address>
   ```

Gmail limits daily sending and may pause an account that sends a lot, so move to Resend (or
another provider) with your own domain before launch.

## Local development without real email

Leave `SMTP_HOST` empty: each email (with its activation link) is written to the worker log. To see
emails as they would look, Mailpit (`npm run infra:up`, needs Docker) catches them at
http://localhost:8025 with `SMTP_HOST=localhost`, `SMTP_PORT=1025`.

**Demo data:** the seeded accounts use `@demo.example.com`, a reserved domain that receives no
mail. The mailer never sends to reserved test domains (`example.com`, `.invalid`, `.test`, ...):
those emails go to the log, so demo activity causes no bounces.
