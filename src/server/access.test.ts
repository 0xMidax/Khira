import { describe, expect, it } from "vitest";
import { allows, effectiveRole } from "./access";
import { db } from "./db";
import { notification, user } from "./db/schema";
import { createCaller } from "./root";
import { findValidInvite } from "./services/invites";
import { eq } from "drizzle-orm";

process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";

const mk = async (id: string, role: "admin" | "member" | "guest") => {
  await db.insert(user).values({ id, name: id, email: `${id}@t.dev`, role, emailVerified: true });
  return createCaller({ db, user: { id, role, name: id, email: `${id}@t.dev` } as never });
};
const admin = await mk("ann", "admin");
const bob = await mk("bob", "member");
const cat = await mk("cat", "member");
const gus = await mk("gus", "guest");

const secret = await admin.project.create({ key: "SEC", name: "Secret" });
await admin.project.setVisibility({ projectId: secret.id, visibility: "private" });
const open = await admin.project.create({ key: "OPN", name: "Open" });
const hidden = await admin.issue.create({ projectId: secret.id, title: "Acquisition plan" });

describe("role rules", () => {
  it("derives the effective role", () => {
    expect(effectiveRole({ id: "a", role: "admin" }, "private", undefined)).toBe("admin");
    expect(effectiveRole({ id: "b", role: "member" }, "private", undefined)).toBeNull();
    expect(effectiveRole({ id: "b", role: "member" }, "open", undefined)).toBe("member");
    expect(effectiveRole({ id: "g", role: "guest" }, "open", "admin")).toBe("viewer"); // guests are capped
    expect(allows("viewer", "write")).toBe(false);
    expect(allows("member", "write")).toBe(true);
    expect(allows("member", "admin")).toBe(false);
  });
});

describe("private projects", () => {
  it("are invisible to non-members everywhere", async () => {
    expect((await bob.project.list()).map((p) => p.key)).toEqual(["OPN"]);
    await expect(bob.project.byKey({ key: "SEC" })).rejects.toThrow(/NOT_FOUND|No project/);
    await expect(bob.issue.byKey({ key: hidden.key as never })).rejects.toThrow(/NOT_FOUND/);
    expect(await bob.issue.search({ q: "Acquisition" })).toEqual([]);
    expect(await bob.search.query({ kql: "title ~ Acquisition" })).toEqual([]);
    expect((await bob.issue.board({ mine: false })).some((i) => i.id === hidden.id)).toBe(false);
    await expect(bob.issue.create({ projectId: secret.id, title: "sneaky" })).rejects.toThrow(/NOT_FOUND/);
    await expect(bob.comment.list({ issueId: hidden.id })).rejects.toThrow(/NOT_FOUND/);
    await expect(bob.issue.update({ id: hidden.id, title: "x" })).rejects.toThrow(/NOT_FOUND/);
    // admins always see everything
    expect((await admin.search.query({ kql: "title ~ Acquisition" })).length).toBe(1);
  });

  it("viewers read, members write, project admins manage", async () => {
    await admin.project.setMember({ projectId: secret.id, userId: "bob", role: "viewer" });
    expect((await bob.project.byKey({ key: "SEC" })).myRole).toBe("viewer");
    expect((await bob.issue.byKey({ key: hidden.key as never })).issue.title).toBe("Acquisition plan");
    await expect(bob.issue.create({ projectId: secret.id, title: "nope" })).rejects.toThrow(/read-only/);

    await admin.project.setMember({ projectId: secret.id, userId: "bob", role: "member" });
    await bob.issue.create({ projectId: secret.id, title: "Bob's task" });
    await expect(bob.workflow.saveStatus({ projectId: secret.id, name: "QA", category: "in_progress", color: "amber", wipLimit: null })).rejects.toThrow(/project admins/);

    await admin.project.setMember({ projectId: secret.id, userId: "cat", role: "admin" });
    await cat.workflow.saveStatus({ projectId: secret.id, name: "QA", category: "in_progress", color: "amber", wipLimit: null });
    await cat.project.removeMember({ projectId: secret.id, userId: "bob" });
    await expect(bob.project.byKey({ key: "SEC" })).rejects.toThrow();
  });

  it("never notifies people who can't see the project", async () => {
    await admin.comment.create({ issueId: hidden.id, body: "ping @[bob](bob) and @[cat](cat)" });
    const { activity } = await import("./db/schema");
    const rows = await db.select({ userId: notification.userId }).from(notification).innerJoin(activity, eq(activity.id, notification.activityId)).where(eq(activity.issueId, hidden.id));
    expect(rows.map((r) => r.userId)).toEqual(["cat"]); // bob was removed above
  });

  it("guests stay read-only even on open projects", async () => {
    await expect(gus.issue.create({ projectId: open.id, title: "x" })).rejects.toThrow(/read-only/);
    expect((await gus.project.list()).map((p) => p.key)).toEqual(["OPN"]);
  });
});

describe("people", () => {
  it("invites carry a role and block duplicates", async () => {
    await admin.invite.create({ email: "New@Team.dev", role: "guest" });
    expect((await findValidInvite(db, "new@team.dev"))?.role).toBe("guest");
    await expect(admin.invite.create({ email: "bob@t.dev" })).rejects.toThrow(/already has an account/);
    await expect(bob.invite.create({ email: "x@y.dev" })).rejects.toThrow(/Admins only/);
    const [inv] = await admin.invite.list();
    await admin.invite.revoke({ id: inv.id });
    expect(await findValidInvite(db, "new@team.dev")).toBeNull();
  });

  it("deactivation offboards someone and can be undone", async () => {
    await expect(admin.user.deactivate({ userId: "ann" })).rejects.toThrow(/yourself/);
    const mine = await admin.issue.create({ projectId: open.id, title: "Cat's work", assigneeId: "cat" });
    expect((await admin.user.deactivate({ userId: "cat" })).unassigned).toBeGreaterThan(0);
    expect((await admin.issue.byKey({ key: mine.key as never })).issue.assigneeId).toBeNull();
    expect((await admin.user.list()).some((u) => u.id === "cat")).toBe(false);
    expect((await admin.user.list({ includeDeactivated: true })).find((u) => u.id === "cat")?.deactivatedAt).toBeInstanceOf(Date);
    await admin.user.reactivate({ userId: "cat" });
    expect((await admin.user.list()).some((u) => u.id === "cat")).toBe(true);
  });
});
