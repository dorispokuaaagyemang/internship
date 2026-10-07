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

## Option A: Brevo (recommended, free 300 emails a day)

1. Sign up at brevo.com.
2. **Senders, domains, IPs → Senders → Add a sender**: the address emails come from. Brevo emails
   it a confirmation link.
3. **SMTP & API → SMTP**: note the **SMTP server**, **port** and **login**. Click **Generate a new
   SMTP key** and copy it (shown once).
4. In `.env` (locally) or the Render settings (production):
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=<the SMTP login, e.g. 8a1b2c001@smtp-brevo.com>
   SMTP_PASSWORD=<the SMTP key>
   MAIL_FROM=Internship Platform <the sender address from step 2>
   ```

With a Gmail or Yahoo address as the sender, mail from Brevo often lands in spam or is refused,
because those providers only trust their own servers for their addresses. For real users, send
from your own domain and authenticate it: **Senders, domains, IPs → Domains → Add a domain**, then
add the DNS records Brevo shows (DKIM, and the SPF and DMARC entries) at your domain registrar.

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

Gmail limits daily sending and may pause an account that sends a lot, so move to Brevo (or
another provider) with your own domain before launch.

## Local development without real email

Leave `SMTP_HOST` empty: each email (with its activation link) is written to the worker log. To see
emails as they would look, Mailpit (`npm run infra:up`, needs Docker) catches them at
http://localhost:8025 with `SMTP_HOST=localhost`, `SMTP_PORT=1025`.

**Demo data:** the seeded accounts use `@demo.example.com`, a reserved domain that receives no
mail. The mailer never sends to reserved test domains (`example.com`, `.invalid`, `.test`, ...):
those emails go to the log, so demo activity causes no bounces.
