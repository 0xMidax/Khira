import { describe, expect, it } from "vitest";
import { mapPriority, parseCsv, parseLooseDate, toCsv } from "@/lib/csv";
import { extractKeys } from "@/lib/issue-keys";
import { describeRecurrence, nextRun } from "@/lib/recurrence";
import { db } from "./db";
import { activity, githubLink, issueTemplate, notification, recurringIssue, user, userSettings } from "./db/schema";
import { createCaller } from "./root";
import { similarityQuery } from "./routers/ai";
import { drainEvents } from "./services/events";
import { handleGithubEvent } from "./services/github";
import { handleInboundEmail, handleSlashCommand } from "./services/inbound";
import { checkSla, dailyNudges, plainStandup, runRecurring, sprintRisk } from "./services/jobs";
import { and, eq } from "drizzle-orm";

process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";

const mk = async (id: string, role: "admin" | "member" = "member") => {
  await db.insert(user).values({ id, name: id[0].toUpperCase() + id.slice(1), email: `${id}@t.dev`, role, emailVerified: true });
  return createCaller({ db, user: { id, role, name: id, email: `${id}@t.dev` } as never });
};
const admin = await mk("ann", "admin");
const bob = await mk("bob");
const p = await admin.project.create({ key: "WEB", name: "Web" });
const { statuses } = await admin.project.byKey({ key: "WEB" });
const [, doing, review, , done] = statuses;

describe("pure helpers", () => {
  it("extracts issue keys from branches, commits and prose", () => {
    expect(extractKeys("web-12-fix-login").map((k) => `${k.key}-${k.number}`)).toEqual(["WEB-12"]);
    expect(extractKeys("Fixes WEB-3 and WEB-3, see OPS-9", new Set(["WEB"])).map((k) => k.number)).toEqual([3]);
    expect(extractKeys("utf-8 and v2-1 are not keys", new Set(["WEB"]))).toEqual([]);
  });
  it("computes recurrence", () => {
    const after = new Date("2026-03-11T10:00:00Z"); // Wednesday
    expect(nextRun({ freq: "weekly", interval: 1, weekday: 1, hour: 9 }, after).toISOString()).toBe("2026-03-16T09:00:00.000Z");
    expect(nextRun({ freq: "daily", interval: 1, hour: 9 }, after).toISOString()).toBe("2026-03-12T09:00:00.000Z");
    expect(nextRun({ freq: "monthly", interval: 1, monthDay: 1, hour: 9 }, after).toISOString()).toBe("2026-04-01T09:00:00.000Z");
    // missed slots are skipped, not replayed
    const prev = new Date("2026-01-05T09:00:00Z");
    expect(nextRun({ freq: "weekly", interval: 1, weekday: 1, hour: 9 }, after, prev).toISOString()).toBe("2026-03-16T09:00:00.000Z");
    expect(describeRecurrence({ freq: "weekly", interval: 2, weekday: 5 })).toBe("Every 2 weeks on Friday at 09:00 UTC");
  });
  it("flags at-risk sprints", () => {
    const s = { startDate: "2026-03-01", endDate: "2026-03-14" };
    expect(sprintRisk(s, 18, 20, new Date("2026-03-08T00:00:00Z")).atRisk).toBe(true);
    expect(sprintRisk(s, 10, 20, new Date("2026-03-08T00:00:00Z")).atRisk).toBe(false);
    expect(sprintRisk(s, 20, 20, new Date("2026-03-02T00:00:00Z")).atRisk).toBe(false); // too early to tell
  });
  it("parses and writes CSV safely", () => {
    expect(parseCsv('Summary,Description\r\n"Login, broken","line1\nline2 ""quoted"""\nNext,\n')).toEqual([
      ["Summary", "Description"],
      ["Login, broken", 'line1\nline2 "quoted"'],
      ["Next", ""],
    ]);
    expect(toCsv(["a", "b"], [["=HYPERLINK(1)", 'x"y']])).toBe('a,b\r\n\'=HYPERLINK(1),"x""y"');
    expect(mapPriority("Highest")).toBe("urgent");
    expect(parseLooseDate("14/Mar/26 3:04 PM")).toBe("2026-03-14");
    expect(parseLooseDate("31/Feb/26")).toBeNull();
    expect(parseLooseDate("32/Jan/26")).toBeNull();
    expect(parseLooseDate("2026-13-45")).toBeNull();
    expect(parseLooseDate("29/Feb/28")).toBe("2028-02-29"); // valid leap day
    expect(parseLooseDate("2026-03-14")).toBe("2026-03-14");
  });
  it("builds similarity queries without punctuation tricks", () => {
    expect(similarityQuery("The login page is broken on Safari!")).toBe("login | page | broken | safari");
    expect(similarityQuery("a ' | & ! ( )")).toBe("");
  });
  it("formats plain standups", () => {
    expect(plainStandup(["WEB-1 a"], [], [])).toContain("*Today*\n• —");
  });
});

describe("GitHub", () => {
  it("links PRs/commits/branches and moves issues on PR events", async () => {
    await admin.workflow.updateSettings({ projectId: p.id, settings: { github: { repos: ["acme/web"], onPrOpened: review.id, onPrMerged: done.id } } });
    await db.insert(userSettings).values({ userId: "bob", githubLogin: "bobdev" });
    const i = await admin.issue.create({ projectId: p.id, title: "Login redirect" }); // WEB-1
    const pr = (action: string, merged = false, repo = "acme/web") => ({
      action,
      repository: { full_name: repo, html_url: `https://github.com/${repo}` },
      pull_request: { number: 7, title: "Fix login (WEB-1)", body: "", html_url: `https://github.com/${repo}/pull/7`, state: merged ? "closed" : "open", merged, head: { ref: "web-1-fix" }, user: { login: "bobdev" } },
    });
    expect(await handleGithubEvent(db, "pull_request", pr("opened", false, "other/repo"))).toEqual({ linked: 0 }); // repo filter
    await handleGithubEvent(db, "pull_request", pr("opened"));
    let row = (await admin.issue.byKey({ key: "WEB-1" as never })).issue;
    expect(row.statusId).toBe(review.id);
    await handleGithubEvent(db, "pull_request", pr("closed", true));
    await handleGithubEvent(db, "push", { ref: "refs/heads/web-1-fix", repository: { full_name: "acme/web" }, commits: [{ id: "abc123", message: "WEB-1 tidy", url: "https://github.com/acme/web/commit/abc123", author: { username: "bobdev" } }] });
    row = (await admin.issue.byKey({ key: "WEB-1" as never })).issue;
    expect(row.statusId).toBe(done.id);
    const links = await db.select().from(githubLink).where(eq(githubLink.issueId, i.id));
    expect(links.map((l) => `${l.kind}:${l.state ?? ""}`).sort()).toEqual(["commit:", "pr:merged"]);
    const acts = await db.select().from(activity).where(and(eq(activity.issueId, i.id), eq(activity.source, "github")));
    expect(acts.every((a) => a.actorId === "bob")).toBe(true); // mapped via githubLogin
  });
});

describe("inbound", () => {
  it("email to the project address lands in triage; replies become comments", async () => {
    process.env.INBOUND_EMAIL_DOMAIN = "in.khira.test";
    const r = await handleInboundEmail(db, { FromFull: { Email: "customer@else.com" }, ToFull: [{ Email: "web@in.khira.test" }], Subject: "Checkout is down", TextBody: "Help!" });
    expect(r).toMatchObject({ action: "created" });
    const triage = await admin.search.query({ kql: "triage = true" });
    expect(triage.map((t) => t.title)).toContain("Checkout is down");
    const reply = await handleInboundEmail(db, { FromFull: { Email: "BOB@t.dev" }, Subject: `Re: [${r.key}] Checkout is down`, StrippedTextReply: "Looking now" });
    expect(reply).toMatchObject({ action: "commented", key: r.key });
    // strangers can't comment by spoofing a reply subject
    expect(await handleInboundEmail(db, { FromFull: { Email: "x@evil.com" }, Subject: `Re: [${r.key}]`, StrippedTextReply: "pwn", ToFull: [{ Email: "nobody@in.khira.test" }] })).toMatchObject({ action: "ignored" });
  });

  it("slash command creates and shows issues", async () => {
    const created = await handleSlashCommand(db, { text: "create WEB Fix the footer", user_id: "U123", channel_id: "C999" });
    expect(created.text).toMatch(/Created .*WEB-\d+/);
    const key = /WEB-\d+/.exec(created.text)![0];
    expect((await handleSlashCommand(db, { text: key, user_id: "U123", channel_id: "C999" })).text).toContain("Fix the footer");
    expect((await handleSlashCommand(db, { text: "create Missing project", user_id: "U123", channel_id: "C999" })).text).toMatch(/Which project/);
    expect((await handleSlashCommand(db, { text: "", user_id: "U1", channel_id: "C1" })).text).toContain("Khira commands");
  });
});

describe("scheduled jobs", () => {
  it("creates recurring issues once per slot, with subtasks", async () => {
    const [t] = await db
      .insert(issueTemplate)
      .values({ projectId: p.id, name: "Deploy", fields: { title: "Deploy {{date}}", subtasks: ["Migrate", "Smoke test"] } })
      .returning();
    await db.insert(recurringIssue).values({ templateId: t.id, rule: { freq: "daily", interval: 1, hour: 9 }, nextRunAt: new Date(Date.now() - 1000), createdBy: "ann" });
    const [a, b] = await Promise.all([runRecurring(db), runRecurring(db)]); // overlapping cron runs
    expect(a.created + b.created).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await admin.search.query({ kql: `title ~ "Deploy ${today}"` });
    expect(rows).toHaveLength(1);
    expect(await admin.search.query({ kql: `parent = ${rows[0].key}` })).toHaveLength(2);
  });

  it("nudges once on SLA breach, stale work and overdue", async () => {
    await admin.workflow.updateSettings({ projectId: p.id, settings: { sla: { urgent: { responseHours: 1, resolveHours: 4 } }, staleDays: 2 } });
    const i = await admin.issue.create({ projectId: p.id, title: "Prod down", priority: "urgent", assigneeId: "bob" });
    const later = new Date(Date.now() + 5 * 3_600_000);
    expect((await checkSla(db, later)).breached).toBe(2);
    expect((await checkSla(db, later)).breached).toBe(0);

    await admin.issue.update({ id: i.id, statusId: doing.id, dueDate: "2020-01-01" });
    const r = await dailyNudges(db, new Date(Date.now() + 3 * 86_400_000));
    expect(r).toMatchObject({ stale: 1 });
    expect(r.overdue).toBeGreaterThanOrEqual(1);
    await drainEvents();
    const bobs = await db.select().from(notification).where(eq(notification.userId, "bob"));
    expect(bobs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("CSV import & AI fallbacks", () => {
  it("imports a JIRA export", async () => {
    const csv = 'Summary,Issue Type,Priority,Status,Assignee,Labels,Custom field (Story Points),Due Date\n"Imported, one",Bug,Highest,Done,bob@t.dev,"ui api",3,14/Mar/26\nImported two,Story,Low,,,,,\n,Task,,,,,,\n';
    const preview = await admin.data.previewCsv({ csv });
    expect(preview.rows).toBe(3);
    const res = await admin.data.importCsv({ projectId: p.id, csv });
    expect(res.created).toBe(2);
    expect(res.errors).toEqual([{ row: 4, message: "Missing title" }]);
    const [one] = await admin.search.query({ kql: 'title ~ "Imported, one"' });
    expect(one).toMatchObject({ type: "bug", priority: "urgent", statusCategory: "done", assigneeName: "Bob", estimate: 3, dueDate: "2026-03-14" });
    expect((await admin.search.query({ kql: "label = api" })).length).toBe(1);
  });

  it("finds likely duplicates without AI", async () => {
    await admin.issue.create({ projectId: p.id, title: "Safari login button does nothing" });
    const sims = await admin.ai.similar({ projectId: p.id, text: "login button broken in safari" });
    expect(sims[0]?.title).toBe("Safari login button does nothing");
  });

  it("AI endpoints explain when no key is configured", async () => {
    await expect(admin.ai.draftIssue({ projectId: p.id, notes: "something broke" })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    const notes = await (async () => {
      const r = await admin.release.save({ projectId: p.id, name: "v1.0" });
      return admin.ai.releaseNotes({ releaseId: r.id });
    })();
    expect(notes).toContain("# v1.0");
  });

  it("REST-style API token flow", async () => {
    const { token } = await bob.integration.createToken({ name: "ci" });
    expect(token).toMatch(/^khira_/);
    const list = await bob.integration.tokens();
    expect(list[0].prefix).toBe(token.slice(0, 12));
    expect(JSON.stringify(list)).not.toContain(token);
  });
});

describe("GitHub branch → status automation", () => {
  it("picks sensible defaults and respects 'don't move'", async () => {
    const { githubTransitions, isForward } = await import("./services/github");
    const st = [
      { id: "t", name: "To Do", category: "todo" as const, position: 0 },
      { id: "p", name: "In Progress", category: "in_progress" as const, position: 1 },
      { id: "r", name: "In Review", category: "in_progress" as const, position: 2 },
      { id: "q", name: "Testing", category: "in_progress" as const, position: 3 },
      { id: "d", name: "Done", category: "done" as const, position: 4 },
    ];
    expect(githubTransitions(st, undefined)).toEqual({ branch: "p", prOpened: "r", merged: "d" });
    expect(githubTransitions(st, { onBranchCreated: null, onPrOpened: "q" })).toEqual({ branch: null, prOpened: "q", merged: "d" });
    expect(githubTransitions(st, { onPrMerged: "deleted-status" }).merged).toBeNull();
    expect(isForward(st, "t", "p")).toBe(true);
    expect(isForward(st, "r", "p")).toBe(false);
    expect(isForward(st, "d", "p")).toBe(false);
  });

  it("creating a branch starts the work and assigns the developer; never moves backwards", async () => {
    await admin.workflow.updateSettings({ projectId: p.id, settings: { github: {} } }); // all defaults
    const i = await admin.issue.create({ projectId: p.id, title: "Branch automation" });
    const branch = (ref: string) => ({ ref, ref_type: "branch", repository: { full_name: "acme/web", html_url: "https://github.com/acme/web" }, sender: { login: "bobdev" } });
    await handleGithubEvent(db, "create", branch(`${i.key.toLowerCase()}-start`));
    let row = (await admin.issue.byKey({ key: i.key as never })).issue;
    expect(row.statusId).toBe(doing.id);
    expect(row.assigneeId).toBe("bob");

    await admin.issue.update({ id: i.id, statusId: done.id });
    await handleGithubEvent(db, "create", branch(`${i.key.toLowerCase()}-followup`));
    row = (await admin.issue.byKey({ key: i.key as never })).issue;
    expect(row.statusId).toBe(done.id); // a late branch doesn't reopen finished work
  });

  it("can turn auto-assign off", async () => {
    await admin.workflow.updateSettings({ projectId: p.id, settings: { github: { autoAssign: false } } });
    const i = await admin.issue.create({ projectId: p.id, title: "No auto assign" });
    await handleGithubEvent(db, "create", { ref: `${i.key}-x`, ref_type: "branch", repository: { full_name: "acme/web", html_url: "https://github.com/acme/web" }, sender: { login: "bobdev" } });
    const row = (await admin.issue.byKey({ key: i.key as never })).issue;
    expect(row.assigneeId).toBeNull();
    expect(row.statusId).toBe(doing.id);
  });
});

describe("Integrations page connections", () => {
  it("stores secrets encrypted, prefers them over env, and never returns them", async () => {
    const { workspaceIntegration } = await import("./db/schema");
    const { getConfig, clearIntegrationCache } = await import("./integrations/config");
    process.env.GITHUB_WEBHOOK_SECRET = "from-env";
    clearIntegrationCache();
    expect((await getConfig("github"))?.webhookSecret).toBe("from-env"); // env fallback

    const { secret } = await admin.integration.connectGithub();
    expect((await getConfig("github"))?.webhookSecret).toBe(secret); // the app connection wins
    const [row] = await db.select().from(workspaceIntegration);
    expect(row.secrets).not.toContain(secret); // encrypted at rest

    const conn = await admin.integration.connections();
    expect(JSON.stringify(conn)).not.toContain(secret);
    expect(conn.github?.source).toBe("app");
    await expect(bob.integration.connections()).rejects.toThrow(/Admins only/);

    await admin.integration.disconnect({ kind: "github" });
    expect((await getConfig("github"))?.webhookSecret).toBe("from-env");
    delete process.env.GITHUB_WEBHOOK_SECRET;
    clearIntegrationCache();
  });

  it("validates email settings and only shows the inbound secret once", async () => {
    await expect(admin.integration.connectEmail({ resendKey: "sk_wrong", from: "x <a@b.co>" })).rejects.toThrow(/start with re_/);
    await expect(admin.integration.connectEmail({ enableInbound: true })).rejects.toThrow(/domain/);
    const first = await admin.integration.connectEmail({ inboundDomain: "in.khira.test", enableInbound: true });
    expect(first.inboundSecret).toMatch(/.{20,}/);
    const again = await admin.integration.connectEmail({ inboundDomain: "in.khira.test", enableInbound: true });
    expect(again.inboundSecret).toBeNull();
    const rotated = await admin.integration.connectEmail({ rotateInbound: true });
    expect(rotated.inboundSecret).not.toBe(first.inboundSecret);
    expect((await admin.integration.status()).inboundEmail).toBe(true);
    await admin.integration.disconnect({ kind: "email" });
  });
});
