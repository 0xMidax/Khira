# Khira

Issue tracking for a small team: Kanban or Scrum projects, custom workflows, KQL search, dashboards and reports, releases, automation, AI assist, and GitHub/Slack/Discord/email integrations. Self-hostable, with invites, roles, private projects and two-step sign-in.

**Stack:** Next.js 15 · tRPC 11 · Drizzle ORM · Postgres (Neon in prod, embedded PGlite locally) · Better Auth · Tailwind 4 · dnd-kit · Vitest · Playwright.

## Run it locally

```bash
pnpm install
cp .env.example .env      # set BETTER_AUTH_SECRET (openssl rand -base64 32) and ALLOWED_SIGNUPS
pnpm dev                  # migrates, then serves http://localhost:3000
```

You don't need a database server. Without `DATABASE_URL`, data goes into an embedded Postgres in `./.pglite`. The first person to sign up becomes the admin.

New accounts must verify their email before they can get in. Locally (without `RESEND_API_KEY`), the verification link is printed in the `pnpm dev` terminal.

**Demo login:** stop `pnpm dev`, run `pnpm db:seed-demo`, start `pnpm dev` again, then sign in as `demo@khira.test` / `KhiraDemo#2026`. You get an admin account and a sample "Demo Project". The seed script refuses to run in production.

If `pnpm dev` crashes with `RuntimeError: Aborted()` from PGlite, the local database was damaged by an unclean stop (for example the dev server being killed when the machine ran out of memory). Move it aside and start fresh: `mv .pglite .pglite-broken-$(date +%F)` then `pnpm db:seed-demo`. Stop `pnpm dev` with Ctrl+C rather than killing it, and never open `.pglite` from two processes at once.

Keyboard shortcuts: <kbd>C</kbd> new issue · <kbd>⌘K</kbd> or <kbd>/</kbd> search · <kbd>[</kbd> collapse or expand the sidebar · <kbd>Esc</kbd> close the open issue. On an issue: <kbd>A</kbd> assign to me, <kbd>S</kbd> status, <kbd>M</kbd> comment. On the board, focus a card and press <kbd>Space</kbd> to pick it up, use the arrow keys to move it, <kbd>Space</kbd> to drop it, or <kbd>O</kbd> to open it.

## Finding your way around

- **My work:** your open issues, grouped into overdue, in progress and up next.
- **Projects:** each project page has tabs for **Summary** (counts, status and workload at a glance), **Timeline**, **Backlog** (Scrum only), **Board**, **Calendar** and **List**, plus links to Releases, Retro, Reports and (for project admins) Settings.
- **Issues** open in a pop-up over the page you're on; <kbd>⌘</kbd>/<kbd>Ctrl</kbd>-click opens the full page in a new tab. Each issue has **Comments** and **History** tabs.
- **Dashboards:** widgets (a number, an issue list, bars by status, person or priority, created vs resolved) built from KQL queries such as `type = bug and category != done`, across every project you can see.
- **Integrations** (admins): GitHub, Slack, Discord, email and outgoing webhooks, all on one page. **Team** (admins): invites, roles, deactivation and a full backup download.
- **Take the tour** in the sidebar walks a new user through all of this.

## Scripts

| | |
|---|---|
| `pnpm test` | Unit and integration tests (in-memory Postgres per run) |
| `pnpm e2e` | Builds into `.next-e2e`, then runs Playwright against it (safe while `pnpm dev` runs) |
| `pnpm db:seed-demo` | Create the demo login and sample project (stop `pnpm dev` first) |
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm db:generate` | Create a migration after you change `src/server/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |

## Self-host with Docker

`docker compose up -d --build` runs the app, Postgres, live updates and the job scheduler on your own server. Full guide: [docs/self-hosting.md](docs/self-hosting.md).

## Deploy (Vercel + Neon)

1. Create a Neon project and copy the **pooled** connection string.
2. Import the repo into Vercel and set the env vars from `.env.example`: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your prod URL) and `ALLOWED_SIGNUPS`.
3. Deploy. The `vercel-build` script runs `drizzle-kit migrate` before `next build`, so the schema is always current.
4. Install the **Neon integration in Vercel**, so each preview deploy gets its own database branch. Without it, previews would migrate the production database.

Migrations must stay backward-compatible (expand first, contract in a later deploy), because the old version keeps serving traffic while the new one rolls out.

Optional: set `GOOGLE_CLIENT_ID/SECRET` and/or `GITHUB_CLIENT_ID/SECRET` to show social sign-in buttons. The OAuth callback URL is `<BETTER_AUTH_URL>/api/auth/callback/<google|github>`.

## Layout

```
src/server/db/schema.ts     tables (issues, statuses, activity log, notifications…)
src/server/services/        domain logic; every write goes through here inside a transaction
src/server/routers/         tRPC procedures (permission check + zod input on each)
src/components/             board, issue detail, shell (sidebar, ⌘K, shortcuts)
src/app/(app)/              signed-in pages
```

Roles: **admin** (also manages the team), **member** (creates and edits), **guest** (read-only). Projects are **open** (everyone in the workspace) or **private** (members only, each as project admin, member or viewer); people outside a private project can't see it at all, in search, dashboards, exports or notifications. Every change is written to the append-only `activity` table, which drives the history tab and notifications.

## Scheduled jobs

`vercel.json` runs these via Vercel Cron (set `CRON_SECRET`): `/api/cron/frequent` every 15 min (recurring issues, SLA nudges), `/api/cron/daily` 07:00 UTC weekdays (stale/overdue/at-risk nudges, digests, standup drafts), `/api/cron/standup` 09:00 UTC (posts standups to Slack), `/api/cron/backup` nightly (JSON snapshot to storage).

## REST API

Create a token under **Your settings → API tokens**, then call `/api/v1` with `Authorization: Bearer khira_…`: `GET /projects`, `GET /issues?kql=…`, `GET|PATCH /issues/KEY-1`, `POST /issues`, `POST /issues/KEY-1/comments`. 300 requests/minute per token.

## Coding agents (MCP)

Claude Code, Codex, Cursor and other MCP clients can work with Khira directly: find your issues, read the details, move them through the workflow, create issues and comment with what they changed. Open **Your settings → Connect a coding agent**, pick your tool, click **Create a token for this** and paste the snippet. For Claude Code that is:

```bash
claude mcp add --transport http khira https://<your-khira>/api/mcp --header "Authorization: Bearer khira_…"
```

The endpoint is `POST /api/mcp` (MCP Streamable HTTP, stateless JSON replies). Tools: `list_projects`, `my_issues`, `search_issues` (KQL), `get_issue`, `create_issue`, `update_issue` (status, assignee, priority, title, description) and `add_comment`. The agent acts as the token's owner, with the same permissions and the same 300 requests/minute limit as the REST API. Revoke the token under API tokens to cut it off.


Admins connect Slack, Discord, email and GitHub, and add signed outgoing webhooks, from the **Integrations** page (secrets are stored encrypted); the env vars in `.env.example` still work as a fallback. GitHub moves issues automatically: branch created → In Progress (and assigned to the developer), PR opened → In Review, PR merged → Done, configurable per project and forward-only. Webhook URLs: GitHub `/api/webhooks/github`, Slack `/api/slack/commands`, `/api/slack/interactivity` (message shortcut callback ID `create_issue`) and `/api/slack/events`, Postmark inbound `/api/webhooks/email`.
