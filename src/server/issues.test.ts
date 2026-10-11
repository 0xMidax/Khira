import { describe, expect, it } from "vitest";
import { isSignupAllowed } from "@/lib/signup";
import { parseMentions, splitMentions } from "@/lib/mentions";
import { db } from "./db";
import { user } from "./db/schema";
import { createCaller } from "./root";

const mkUser = async (id: string, role: "admin" | "member" | "guest") => {
  await db.insert(user).values({ id, name: id, email: `${id}@t.dev`, role });
  return createCaller({ db, user: { id, role, name: id, email: `${id}@t.dev` } as never });
};

const admin = await mkUser("ann", "admin");
const bob = await mkUser("bob", "member");
const guest = await mkUser("gus", "guest");
const p = await admin.project.create({ key: "khr", name: "Khira" });
const proj = await admin.project.byKey({ key: "KHR" });
const [todo, doing, , , done] = proj.statuses;

describe("projects", () => {
  it("creates default workflow and normalises key", () => {
    expect(p.key).toBe("KHR");
    expect(proj.statuses.map((s) => s.category)).toEqual(["todo", "in_progress", "in_progress", "in_progress", "done"]);
  });
  it("rejects duplicate keys", async () => {
    await expect(admin.project.create({ key: "KHR", name: "x" })).rejects.toThrow(/taken/);
  });
});

describe("issues", () => {
  it("numbers sequentially, notifies the assignee but not the actor", async () => {
    const a = await admin.issue.create({ projectId: p.id, title: "First", assigneeId: "bob" });
    const b = await admin.issue.create({ projectId: p.id, title: "Second" });
    expect([a.key, b.key]).toEqual(["KHR-1", "KHR-2"]);
    expect(a.statusId).toBe(todo.id);
    expect(await bob.notification.unreadCount()).toBe(1);
    expect(await admin.notification.unreadCount()).toBe(0);
  });

  it("moves within/between columns keeping order and resolution", async () => {
    const c = await admin.issue.create({ projectId: p.id, title: "Third" });
    const [i1, i2] = await admin.issue.list({ projectId: p.id }).then((r) => r.filter((x) => x.statusId === todo.id));
    // put Third between KHR-1 and KHR-2
    await bob.issue.move({ id: c.id, statusId: todo.id, afterId: i1.id, beforeId: i2.id });
    let col = (await admin.issue.list({ projectId: p.id })).filter((x) => x.statusId === todo.id).map((x) => x.key);
    expect(col).toEqual(["KHR-1", "KHR-3", "KHR-2"]);

    const moved = await bob.issue.move({ id: c.id, statusId: done.id, afterId: null, beforeId: null });
    expect(moved.resolvedAt).toBeInstanceOf(Date);
    const back = await bob.issue.move({ id: c.id, statusId: doing.id, afterId: null, beforeId: null });
    expect(back.resolvedAt).toBeNull();
    col = (await admin.issue.list({ projectId: p.id })).filter((x) => x.statusId === todo.id).map((x) => x.key);
    expect(col).toEqual(["KHR-1", "KHR-2"]);

    const history = await admin.issue.activity({ issueId: c.id });
    expect(history.map((h) => h.verb)).toEqual(["updated", "updated", "created"]); // the reorder alone is not logged
  });

  it("rejects cross-project status and self-parenting", async () => {
    const other = await admin.project.create({ key: "OPS", name: "Ops" });
    const otherStatus = (await admin.project.byKey({ key: "OPS" })).statuses[0];
    await expect(admin.issue.create({ projectId: other.id, title: "x", statusId: todo.id })).rejects.toThrow(/Status/);
    const i = await admin.issue.create({ projectId: p.id, title: "y" });
    await expect(admin.issue.update({ id: i.id, statusId: otherStatus.id })).rejects.toThrow(/Status/);
    await expect(admin.issue.update({ id: i.id, parentId: i.id })).rejects.toThrow(/own parent/);
  });

  it("guests are read-only", async () => {
    await expect(guest.issue.create({ projectId: p.id, title: "nope" })).rejects.toThrow(/read-only/);
    expect((await guest.issue.list({ projectId: p.id })).length).toBeGreaterThan(0);
  });

  it("soft-deletes and restores", async () => {
    const i = await admin.issue.create({ projectId: p.id, title: "Temp" });
    await admin.issue.delete({ id: i.id });
    expect((await admin.issue.list({ projectId: p.id })).some((x) => x.id === i.id)).toBe(false);
    await admin.issue.restore({ id: i.id });
    expect((await admin.issue.list({ projectId: p.id })).some((x) => x.id === i.id)).toBe(true);
  });

  it("searches by key and text", async () => {
    await admin.issue.create({ projectId: p.id, title: "Login button broken on Safari", type: "bug" });
    expect((await admin.issue.search({ q: "KHR-1" }))[0].key).toBe("KHR-1");
    expect((await admin.issue.search({ q: "safari" }))[0].title).toMatch(/Safari/);
    expect(await admin.issue.list({ projectId: p.id, q: "button" })).toHaveLength(1);
  });
});

describe("comments", () => {
  it("notifies mentions and watchers, ignores unknown ids", async () => {
    const i = await bob.issue.create({ projectId: p.id, title: "Needs review" });
    const before = await admin.notification.unreadCount();
    await bob.comment.create({ issueId: i.id, body: "hey @[ann](ann) and @[ghost](nobody)" });
    expect(await admin.notification.unreadCount()).toBe(before + 1);
    await admin.comment.create({ issueId: i.id, body: "on it" }); // bob watches as reporter
    const list = await bob.notification.list();
    expect(list[0]).toMatchObject({ reason: "watching", verb: "commented" });
    await expect(admin.comment.edit({ id: (await admin.comment.list({ issueId: i.id }))[0].id, body: "x" })).rejects.toThrow(/own/);
  });
});

describe("roles", () => {
  it("keeps at least one admin", async () => {
    await expect(admin.user.setRole({ userId: "ann", role: "member" })).rejects.toThrow(/at least one admin/);
    await expect(bob.user.setRole({ userId: "bob", role: "admin" })).rejects.toThrow(/Admins only/);
  });
});

describe("pure helpers", () => {
  it("signup allow-list", () => {
    expect(isSignupAllowed("x@a.com", undefined, true)).toBe(true);
    expect(isSignupAllowed("x@a.com", undefined, false)).toBe(false);
    expect(isSignupAllowed("X@A.com", "a.com, b.io", false)).toBe(true);
    expect(isSignupAllowed("x@evil-a.com", "a.com", false)).toBe(false);
    expect(isSignupAllowed("me@gmail.com", "me@gmail.com", false)).toBe(true);
    expect(isSignupAllowed("you@gmail.com", "me@gmail.com", false)).toBe(false);
  });
  it("mentions", () => {
    expect(parseMentions("@[A](u1) @[B](u2) @[A](u1)")).toEqual(["u1", "u2"]);
    expect(splitMentions("hi @[A](u1)!")).toEqual(["hi ", { name: "A", id: "u1" }, "!"]);
  });
});

describe("project list", () => {
  it("lists projects with open-issue counts", async () => {
    const before = (await admin.project.list()).find((x) => x.key === "KHR")!.openIssues;
    const i = await admin.issue.create({ projectId: p.id, title: "count me" });
    expect((await admin.project.list()).find((x) => x.key === "KHR")!.openIssues).toBe(before + 1);
    await admin.issue.delete({ id: i.id });
  });
});
