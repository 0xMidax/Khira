import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hmacHex } from "@/lib/crypto";
import { KqlError, parseKql, parseRelativeDate } from "@/lib/kql";
import { db } from "./db";
import { automationRule, user } from "./db/schema";
import { verifySlack } from "./integrations/slack";
import { assertPublicUrl } from "./integrations/webhooks";
import { createCaller } from "./root";
import { conditionsMatch } from "./services/automation";
import { drainEvents } from "./services/events";

process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";

const mk = async (id: string, role: "admin" | "member" = "member") => {
  await db.insert(user).values({ id, name: id[0].toUpperCase() + id.slice(1), email: `${id}@t.dev`, role, emailVerified: true });
  return createCaller({ db, user: { id, role, name: id, email: `${id}@t.dev` } as never });
};
const admin = await mk("ann", "admin");
const bob = await mk("bob");
const p = await admin.project.create({ key: "APP", name: "App" });
const { statuses } = await admin.project.byKey({ key: "APP" });
const [todo, doing, review, , done] = statuses;

describe("KQL parser", () => {
  it("parses precedence, lists, functions and order", () => {
    const q = parseKql('project = APP and (type in (bug, story) or priority >= high) and assignee = me() order by priority desc, created');
    expect(q.orderBy).toEqual([
      { field: "priority", dir: "desc" },
      { field: "created", dir: "asc" },
    ]);
    expect(q.where?.type).toBe("and");
    expect(parseKql("sprint in openSprints()").where).toMatchObject({ field: "sprint", op: "in", values: [{ kind: "fn", name: "opensprints" }] });
    expect(parseKql('assignee is not empty and not text ~ "foo bar"').where).toMatchObject({ type: "and", right: { type: "not" } });
    expect(parseKql("").where).toBeNull();
  });
  it("reports helpful errors", () => {
    expect(() => parseKql("colour = red")).toThrow(/Unknown field/);
    expect(() => parseKql("type = ")).toThrow(KqlError);
    expect(() => parseKql('title ~ "open')).toThrow(/Unclosed quote/);
    expect(() => parseKql("type in (bug")).toThrow();
  });
  it("relative dates", () => {
    const now = new Date("2026-03-10T12:00:00Z");
    expect(parseRelativeDate("-7d", now)!.toISOString().slice(0, 10)).toBe("2026-03-03");
    expect(parseRelativeDate("2w", now)!.toISOString().slice(0, 10)).toBe("2026-03-24");
    expect(parseRelativeDate("nope", now)).toBeNull();
  });
});

describe("KQL queries", () => {
  it("filters by real data", async () => {
    await admin.issue.create({ projectId: p.id, title: "Crash on login", type: "bug", priority: "urgent", assigneeId: "bob" });
    await admin.issue.create({ projectId: p.id, title: "Dark mode", type: "story", priority: "low" });
    const label = await admin.project.createLabel({ projectId: p.id, name: "ui" });
    const c = await admin.issue.create({ projectId: p.id, title: "Settings page", type: "task", priority: "medium", labelIds: [label.id] });
    await admin.issue.update({ id: c.id, statusId: done.id });

    const keys = async (kql: string, as = admin) => (await as.search.query({ kql })).map((r) => r.title).sort();
    expect(await keys("type = bug")).toEqual(["Crash on login"]);
    expect(await keys("priority >= medium order by priority desc")).toEqual(["Crash on login", "Settings page"]);
    expect(await keys("assignee = me()", bob)).toEqual(["Crash on login"]);
    expect(await keys("assignee is empty")).toEqual(["Dark mode", "Settings page"]);
    expect(await keys("assignee != bob")).toEqual(["Dark mode", "Settings page"]); // JQL: includes unassigned
    expect(await keys("label = ui")).toEqual(["Settings page"]);
    expect(await keys("category = done")).toEqual(["Settings page"]);
    expect(await keys('status = "to do" and text ~ dark')).toEqual(["Dark mode"]);
    expect(await keys("created > -1d and resolved is empty")).toEqual(["Crash on login", "Dark mode"]);
    expect(await keys("key = APP-1")).toEqual(["Crash on login"]);
    // values are parameters, not SQL
    expect(await keys(`title ~ "'; drop table issue; --"`)).toEqual([]);
    await expect(admin.search.query({ kql: "bogus = 1" })).rejects.toThrow(/Unknown field/);
  });

  it("saves filters (validating first) and shares them", async () => {
    await bob.search.saveFilter({ name: "My bugs", kql: "type = bug and assignee = me()", shared: true });
    await expect(bob.search.saveFilter({ name: "Bad", kql: "type ==" })).rejects.toThrow();
    expect((await admin.search.filters()).map((f) => f.name)).toContain("My bugs");
  });
});

describe("sprints", () => {
  it("plans, starts, burns down and completes with carry-over", async () => {
    const s1 = await admin.sprint.create({ projectId: p.id });
    expect(s1.name).toBe("APP Sprint 1");
    const a = await admin.issue.create({ projectId: p.id, title: "S1 a", estimate: 3, sprintId: s1.id });
    const b = await admin.issue.create({ projectId: p.id, title: "S1 b", estimate: 5, sprintId: s1.id });
    const today = new Date().toISOString().slice(0, 10);
    const later = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
    const started = await admin.sprint.start({ id: s1.id, startDate: today, endDate: later, goal: "Ship it" });
    expect(started.committedPoints).toBe(8);

    const s2 = await admin.sprint.create({ projectId: p.id });
    await expect(admin.sprint.start({ id: s2.id, startDate: today, endDate: later })).rejects.toThrow(/active sprint/);
    expect((await admin.search.query({ kql: "sprint in openSprints()" })).map((r) => r.title).sort()).toEqual(["S1 a", "S1 b"]);

    await admin.issue.update({ id: a.id, statusId: done.id });
    const bd = await admin.sprint.burndown({ id: s1.id });
    expect(bd.unit).toBe("points");
    expect(bd.days[0]).toMatchObject({ ideal: 8, remaining: 5 });

    const res = await admin.sprint.complete({ id: s1.id, moveTo: s2.id });
    expect(res.carriedOver).toBe(1);
    expect(res.sprint.completedPoints).toBe(3);
    expect((await admin.search.query({ kql: `sprint = "${s2.name}"` })).map((r) => r.id)).toEqual([b.id]);
    expect((await admin.sprint.velocity({ projectId: p.id }))[0]).toMatchObject({ committed: 8, completed: 3 });
    await expect(admin.issue.update({ id: b.id, sprintId: s1.id })).rejects.toThrow(/closed/);
  });
});

describe("workflow rules", () => {
  it("enforces transitions when defined", async () => {
    const i = await admin.issue.create({ projectId: p.id, title: "flow" });
    await admin.workflow.setTransitions({
      projectId: p.id,
      transitions: [
        { from: todo.id, to: doing.id },
        { from: doing.id, to: review.id },
        { from: review.id, to: done.id },
      ],
    });
    await expect(admin.issue.update({ id: i.id, statusId: done.id })).rejects.toThrow(/doesn't allow/);
    await admin.issue.update({ id: i.id, statusId: doing.id });
    await admin.workflow.setTransitions({ projectId: p.id, transitions: [] });
    await admin.issue.update({ id: i.id, statusId: done.id });
    await expect(bob.workflow.setTransitions({ projectId: p.id, transitions: [] })).rejects.toThrow(/project admins/);
  });

  it("blocks done while subtasks are open, when enabled", async () => {
    await admin.workflow.updateSettings({ projectId: p.id, settings: { requireSubtasksDone: true } });
    const parent = await admin.issue.create({ projectId: p.id, title: "parent" });
    const child = await admin.issue.create({ projectId: p.id, title: "child", parentId: parent.id, type: "subtask" });
    await expect(admin.issue.update({ id: parent.id, statusId: done.id })).rejects.toThrow(/open subtask/);
    await admin.issue.update({ id: child.id, statusId: done.id });
    await admin.issue.update({ id: parent.id, statusId: done.id });
    await expect(admin.issue.update({ id: parent.id, parentId: child.id })).rejects.toThrow(/loop/);
    await admin.workflow.updateSettings({ projectId: p.id, settings: { requireSubtasksDone: false } });
  });

  it("deletes a status by moving its issues", async () => {
    const s = await admin.workflow.saveStatus({ projectId: p.id, name: "QA", category: "in_progress", color: "amber", wipLimit: 3 });
    const i = await admin.issue.create({ projectId: p.id, title: "in qa", statusId: s.id });
    await admin.workflow.deleteStatus({ projectId: p.id, id: s.id, moveTo: review.id });
    expect((await admin.search.query({ kql: "status = 'in review'" })).some((r) => r.id === i.id)).toBe(true);
  });
});

describe("automation", () => {
  it("matches conditions", () => {
    const f = { id: "1", key: "A-1", title: "Login broken", type: "bug", priority: "urgent", statusId: "s", assigneeId: null, labelIds: ["l1"] };
    expect(conditionsMatch([{ field: "type", op: "is", value: "bug" }, { field: "labelId", op: "is", value: "l1" }], f)).toBe(true);
    expect(conditionsMatch([{ field: "title", op: "contains", value: "LOGIN" }], f)).toBe(true);
    expect(conditionsMatch([{ field: "assigneeId", op: "isNot", value: null }], f)).toBe(false);
  });

  it("runs rules after commit and never loops", async () => {
    await db.insert(automationRule).values({
      projectId: p.id,
      name: "Urgent bugs go to Bob",
      trigger: "created",
      conditions: [
        { field: "type", op: "is", value: "bug" },
        { field: "priority", op: "is", value: "urgent" },
      ],
      actions: [
        { type: "assign", userId: "bob" },
        { type: "comment", body: "Auto-assigned {{key}}" },
      ],
      createdBy: "ann",
    });
    const i = await admin.issue.create({ projectId: p.id, title: "Prod down", type: "bug", priority: "urgent" });
    await drainEvents();
    const after = await admin.search.query({ kql: `key = ${i.key}` });
    expect(after[0].assigneeId).toBe("bob");
    const comments = await admin.comment.list({ issueId: i.id });
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe(`Auto-assigned ${i.key}`);
  });
});

describe("time & reports", () => {
  it("logs time and builds reports", async () => {
    const i = await bob.issue.create({ projectId: p.id, title: "timed" });
    await bob.time.log({ issueId: i.id, minutes: 90, note: "pairing" });
    const today = new Date().toISOString().slice(0, 10);
    expect((await admin.time.timesheet({ from: today, to: today })).find((r) => r.issueTitle === "timed")?.minutes).toBe(90);
    await expect(admin.time.log({ issueId: i.id, minutes: 0 })).rejects.toThrow();

    const cfd = await admin.reports.cfd({ projectId: p.id, days: 7 });
    expect(cfd.points).toHaveLength(7);
    const last = cfd.points.at(-1)! as Record<string, number | string>;
    expect(cfd.statuses.reduce((n, s) => n + Number(last[s.id] ?? 0), 0)).toBeGreaterThan(5);
    const cvr = await admin.reports.createdVsResolved({ projectId: p.id, days: 7 });
    expect(cvr.at(-1)!.created).toBeGreaterThan(0);
    const ct = await admin.reports.cycleTime({ projectId: p.id });
    expect(ct.count).toBeGreaterThan(0);
    expect((await admin.reports.workload({ projectId: p.id })).find((w) => w.name === "Bob")?.issues).toBeGreaterThan(0);
  });
});

describe("security helpers", () => {
  it("encrypts round-trip and rejects tampering", () => {
    const box = encrypt("https://discord.com/api/webhooks/1/abc");
    expect(decrypt(box)).toBe("https://discord.com/api/webhooks/1/abc");
    const parts = box.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("verifies Slack signatures with a replay window", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "token=x&text=hi";
    const sig = `v0=${hmacHex("s3cret", `v0:${ts}:${body}`)}`;
    expect(verifySlack(body, ts, sig, "s3cret")).toBe(true);
    expect(verifySlack(body + "x", ts, sig, "s3cret")).toBe(false);
    expect(verifySlack(body, String(Number(ts) - 600), sig, "s3cret")).toBe(false);
    expect(verifySlack(body, ts, sig, null)).toBe(false); // not connected
  });
  it("blocks private webhook targets in production", () => {
    const env = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() => assertPublicUrl("https://169.254.169.254/latest")).toThrow();
    expect(() => assertPublicUrl("https://localhost:3000")).toThrow();
    expect(() => assertPublicUrl("http://example.com")).toThrow(/https/);
    expect(assertPublicUrl("https://hooks.example.com/x").hostname).toBe("hooks.example.com");
    (process.env as Record<string, string>).NODE_ENV = env!;
  });
});

describe("retro", () => {
  it("adds notes, toggles votes atomically, turns actions into issues", async () => {
    const s = await admin.sprint.create({ projectId: p.id, name: "Retro sprint" });
    const note = await bob.retro.add({ sprintId: s.id, column: "action", body: "Write runbook for deploys" });
    await Promise.all([bob.retro.vote({ id: note.id }), admin.retro.vote({ id: note.id })]);
    let [item] = await admin.retro.items({ sprintId: s.id });
    expect(item.item.votes.sort()).toEqual(["ann", "bob"]);
    await bob.retro.vote({ id: note.id }); // toggle off
    [item] = await admin.retro.items({ sprintId: s.id });
    expect(item.item.votes).toEqual(["ann"]);
    const created = await admin.retro.toIssue({ id: note.id });
    expect(created.title).toBe("Write runbook for deploys");
    await expect(admin.retro.toIssue({ id: note.id })).rejects.toThrow(/Already/);
    await expect(admin.retro.remove({ id: note.id })).resolves.toBeUndefined(); // admin may remove
  });
});

describe("push subscriptions", () => {
  it("accepts only real push services and never hijacks another user's endpoint", async () => {
    const keys = { p256dh: "k", auth: "a" };
    await expect(bob.settings.subscribePush({ endpoint: "http://169.254.169.254/latest", keys })).rejects.toThrow(/Unsupported push service/);
    await expect(bob.settings.subscribePush({ endpoint: "https://fcm.googleapis.com.evil.com/x", keys })).rejects.toThrow(/Unsupported/);
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    await bob.settings.subscribePush({ endpoint, keys });
    await admin.settings.subscribePush({ endpoint, keys: { p256dh: "x", auth: "y" } });
    const { pushSubscription } = await import("./db/schema");
    const [row] = await db.select().from(pushSubscription);
    expect(row).toMatchObject({ userId: "bob", keys });
  });
});

describe("kanban & team board", () => {
  it("creates kanban projects and hides old done cards on request", async () => {
    const k = await admin.project.create({ key: "OPSK", name: "Ops", method: "kanban" });
    const kp = await admin.project.byKey({ key: "OPSK" });
    expect(kp.settings.method).toBe("kanban");
    const done = kp.statuses.find((s) => s.category === "done")!;
    const old = await admin.issue.create({ projectId: k.id, title: "old done", statusId: done.id });
    await admin.issue.create({ projectId: k.id, title: "fresh todo" });
    const { issue } = await import("./db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(issue).set({ resolvedAt: new Date(Date.now() - 30 * 86_400_000) }).where(eq(issue.id, old.id));
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    expect((await admin.issue.list({ projectId: k.id, resolvedSince: since })).map((i) => i.title)).toEqual(["fresh todo"]);
    expect(await admin.issue.list({ projectId: k.id })).toHaveLength(2);
  });

  it("team board spans projects and moves by category", async () => {
    const board = await bob.issue.board({ mine: false });
    expect(new Set(board.map((b) => b.projectKey)).size).toBeGreaterThan(1);
    expect(board.some((b) => b.title === "old done")).toBe(false); // done > 14 days ago
    const mine = await bob.issue.board({ mine: true });
    expect(mine.every((b) => b.assigneeId === "bob")).toBe(true);

    const t = await admin.issue.create({ projectId: p.id, title: "team board move" });
    await admin.issue.moveToStatus({ id: t.id, name: "testing" }); // case-insensitive name match
    let [row] = await admin.search.query({ kql: `key = ${t.key}` });
    expect(row.statusName).toBe("Testing");
    expect(await admin.issue.moveToStatus({ id: t.id, name: "Testing" })).toBeNull(); // same column: untouched
    await expect(admin.issue.moveToStatus({ id: t.id, name: "Blocked" })).rejects.toThrow(/has no “Blocked” status/);
    await admin.issue.moveToStatus({ id: t.id, name: "In Review" });
    [row] = await admin.search.query({ kql: `key = ${t.key}` });
    expect(row.statusId).toBe(review.id);
    await expect(guestCaller().issue.moveToStatus({ id: t.id, name: "Done" })).rejects.toThrow(/read-only/);
  });
});

function guestCaller() {
  return createCaller({ db, user: { id: "bob", role: "guest", name: "bob", email: "bob@t.dev" } as never });
}

describe("team board columns", () => {
  it("merges same-named statuses across projects in workflow order", async () => {
    const { mergeColumns } = await import("./routers/issue");
    const cols = mergeColumns([
      { name: "Done", category: "done", color: "green", position: 4 },
      { name: "To Do", category: "todo", color: "slate", position: 0 },
      { name: "testing", category: "in_progress", color: "amber", position: 3 },
      { name: "In Progress", category: "in_progress", color: "blue", position: 1 },
      { name: "Testing", category: "in_progress", color: "amber", position: 3 },
      { name: "done", category: "done", color: "green", position: 3 },
    ]);
    expect(cols.map((c) => c.id)).toEqual(["to do", "in progress", "testing", "done"]);
    const live = await admin.issue.boardColumns();
    expect(live.map((c) => c.name)).toEqual(expect.arrayContaining(["To Do", "In Progress", "In Review", "Testing", "Done"]));
  });
});
