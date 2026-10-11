# Self-hosting Khira

Khira runs anywhere Docker runs: one small VM (2 vCPU, 2 GB RAM) is plenty for a team of 50.
The compose file starts four containers: the **app**, **Postgres**, **Soketi** (live updates) and a **scheduler** for daily jobs.

## Quick start

```bash
git clone <your fork> khira && cd khira
cp .env.example .env
```

Fill the **required** block in `.env`:

| Variable | What to put |
|---|---|
| `POSTGRES_PASSWORD` | any long random string |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | the URL people will open, e.g. `https://khira.acme.com` |
| `ALLOWED_SIGNUPS` | your email domain, e.g. `acme.com` (the first person to sign up becomes admin; invite others from Team) |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `PUSHER_SECRET` | `openssl rand -hex 24` |
| Email: `SMTP_URL` + `EMAIL_FROM` | your mail server, e.g. `smtp://user:pass@smtp.acme.com:587`. Needed so people can verify their email and reset passwords |

Then:

```bash
docker compose up -d --build
docker compose logs -f app      # wait for "Ready"
```

Open `http://<server>:3000`, sign up with your work email, and you're the admin.

## Put it behind HTTPS

Run any reverse proxy in front. With [Caddy](https://caddyserver.com) (automatic TLS certificates), a whole `Caddyfile` is:

```
khira.acme.com {
  reverse_proxy localhost:3000
}
realtime.khira.acme.com {
  reverse_proxy localhost:6001
}
```

Then in `.env`: `BETTER_AUTH_URL=https://khira.acme.com`, `PUSHER_PUBLIC_HOST=realtime.khira.acme.com`, `PUSHER_PUBLIC_PORT=443`, `PUSHER_PUBLIC_TLS=true`, and `docker compose up -d` again.
Live updates are optional: without Soketi reachable, Khira falls back to refreshing every 30 seconds.

## Where data lives

| Data | Location | Back it up with |
|---|---|---|
| Everything (issues, comments, users) | Postgres volume `db-data` | `docker compose exec db pg_dump -U khira khira > khira-$(date +%F).sql` |
| Attachments | volume `uploads` (or S3/R2 if you set `S3_*`) | copy the volume, or your bucket's versioning |
| Nightly JSON export | `uploads/backups/` (written by the scheduler) | included in the volume backup |

Restore a dump into a fresh install: `docker compose exec -T db psql -U khira khira < khira-2026-01-31.sql`.

## Upgrading

```bash
git pull
docker compose up -d --build
```

The `migrate` container applies new database migrations before the app starts. Migrations are written to be backward-compatible, so a failed upgrade can be rolled back by checking out the previous version and running `docker compose up -d --build` again.
**Take a `pg_dump` before every upgrade.**

## Using a managed Postgres instead

Remove the `db` service, and set `DATABASE_URL` in `.env` (and in the `migrate` service) to your provider's connection string. Any Postgres 14+ works (RDS, Cloud SQL, Neon, Supabase).

## Optional features

Everything below is switched on by adding settings to `.env` (see `.env.example`) or, for chat/GitHub/email, from **Integrations** inside the app:

- **Slack, Discord, GitHub, email-to-issue:** admins connect them on the Integrations page. Their webhooks need Khira reachable from the internet (HTTPS above).
- **AI features:** `ANTHROPIC_API_KEY`.
- **S3/R2 attachments:** `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- **Web push:** `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`).
- **Error tracking:** `SENTRY_DSN`.

## Health and troubleshooting

- `GET /api/health` returns `{"ok":true}` when the app can reach Postgres (Docker's healthcheck uses it).
- `docker compose ps`: `migrate` should show **Exited (0)**. If it failed, `docker compose logs migrate` shows why (usually a wrong `POSTGRES_PASSWORD` after the volume was first created with another one).
- Nobody receives verification emails: check `SMTP_URL`, then `docker compose logs app | grep -i mail`.
- Scheduled jobs: `docker compose logs scheduler`. Times are UTC.
