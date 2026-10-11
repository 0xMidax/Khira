import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { parseMentions } from "@/lib/mentions";
import type { IssueCreateInput, IssueUpdateInput } from "@/lib/validators";
import type { DB, Tx } from "../db";
import {
  activity,
  comment,
  issue,
  issueLabel,
  label,
  notification,
  project,
  release,
  sprint,
  user,
  watcher,
  workflowStatus,
  workflowTransition,
} from "../db/schema";
import { usersWithAccess } from "../access";
import { dispatchActivities } from "./events";

type Reason = "assigned" | "mentioned" | "watching";
export type Source = "user" | "automation" | "github" | "slack" | "email" | "system" | "api" | "import";

// ---------- write wrapper: collect activity ids per transaction, fan out after commit ----------

const pending = new WeakMap<object, string[]>();

/** Run a write in a transaction; once it commits, dispatch side effects for every activity it logged. */
export async function write<T>(db: DB, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let ids: string[] = [];
  const result = await db.transaction(async (tx) => {
    pending.set(tx, []);
    const r = await fn(tx);
    ids = pending.get(tx) ?? [];
    return r;
  });
  if (ids.length) dispatchActivities(ids);
  return result;
}

export async function logActivity(tx: Tx, values: typeof activity.$inferInsert) {
  const [act] = await tx.insert(activity).values(values).returning();
  pending.get(tx)?.push(act.id);
  return act;
}

// ---------- helpers ----------

async function notify(tx: Tx, projectId: string, activityId: string, actorId: string, recipients: Map<string, Reason>) {
  recipients.delete(actorId);
  if (!recipients.size) return;
  // Only people who can see the project (mention ids are user-written, so this also drops unknown ids before they hit the FK).
  const known = new Set(await usersWithAccess(tx, projectId, [...recipients.keys()]));
  for (const id of recipients.keys()) if (!known.has(id)) recipients.delete(id);
  if (!recipients.size) return;
  await tx.insert(notification).values([...recipients].map(([userId, reason]) => ({ userId, activityId, reason })));
}

async function watchers(tx: Tx, issueId: string) {
  const rows = await tx.select({ userId: watcher.userId }).from(watcher).where(eq(watcher.issueId, issueId));
  return rows.map((r) => r.userId);
}

export async function watch(tx: Tx, issueId: string, userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  if (ids.length) await tx.insert(watcher).values(ids.map((userId) => ({ issueId, userId }))).onConflictDoNothing();
}

async function getStatus(tx: Tx, projectId: string, statusId: string) {
  const [s] = await tx
    .select()
    .from(workflowStatus)
    .where(and(eq(workflowStatus.id, statusId), eq(workflowStatus.projectId, projectId)));
  if (!s) throw new TRPCError({ code: "BAD_REQUEST", message: "Status does not belong to this project." });
  return s;
}

async function assertUser(tx: Tx, userId: string | null | undefined) {
  if (!userId) return;
  const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown user." });
}

async function assertParent(tx: Tx, projectId: string, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw new TRPCError({ code: "BAD_REQUEST", message: "An issue cannot be its own parent." });
  // Walk up to stop cycles (A → B → A).
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 20; depth++) {
    const [p]: { id: string; projectId: string; parentId: string | null }[] = await tx
      .select({ id: issue.id, projectId: issue.projectId, parentId: issue.parentId })
      .from(issue)
      .where(and(eq(issue.id, cursor), isNull(issue.deletedAt)));
    if (!p || p.projectId !== projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "Parent must be an issue in the same project." });
    if (selfId && p.parentId === selfId) throw new TRPCError({ code: "BAD_REQUEST", message: "That would make a parent loop." });
    cursor = p.parentId;
  }
}

async function assertLabels(tx: Tx, projectId: string, labelIds: string[]) {
  if (!labelIds.length) return;
  const rows = await tx
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.projectId, projectId), inArray(label.id, labelIds)));
  if (rows.length !== new Set(labelIds).size) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown label." });
}

async function assertSprint(tx: Tx, projectId: string, sprintId: string | null | undefined) {
  if (!sprintId) return;
  const [s] = await tx.select({ state: sprint.state }).from(sprint).where(and(eq(sprint.id, sprintId), eq(sprint.projectId, projectId)));
  if (!s) throw new TRPCError({ code: "BAD_REQUEST", message: "Sprint does not belong to this project." });
  if (s.state === "closed") throw new TRPCError({ code: "BAD_REQUEST", message: "That sprint is already closed." });
}

async function assertRelease(tx: Tx, projectId: string, releaseId: string | null | undefined) {
  if (!releaseId) return;
  const [r] = await tx.select({ id: release.id }).from(release).where(and(eq(release.id, releaseId), eq(release.projectId, projectId)));
  if (!r) throw new TRPCError({ code: "BAD_REQUEST", message: "Release does not belong to this project." });
}

/** Enforces the project's transition table and "subtasks must be done" rule. */
async function assertTransition(tx: Tx, cur: { id: string; projectId: string; statusId: string }, toStatusId: string, toCategory: string) {
  const rules = await tx
    .select({ from: workflowTransition.fromStatusId, to: workflowTransition.toStatusId })
    .from(workflowTransition)
    .where(eq(workflowTransition.projectId, cur.projectId));
  if (rules.length && !rules.some((r) => r.from === cur.statusId && r.to === toStatusId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This workflow doesn't allow that status change." });
  }
  if (toCategory !== "done") return;
  const [p] = await tx.select({ settings: project.settings }).from(project).where(eq(project.id, cur.projectId));
  if (!p.settings.requireSubtasksDone) return;
  const [{ open }] = await tx
    .select({ open: count() })
    .from(issue)
    .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
    .where(and(eq(issue.parentId, cur.id), isNull(issue.deletedAt), ne(workflowStatus.category, "done")));
  if (open) throw new TRPCError({ code: "BAD_REQUEST", message: `Finish the ${open} open subtask${open === 1 ? "" : "s"} first.` });
}

export async function lastRank(tx: Tx | DB, projectId: string) {
  const [last] = await tx.select({ rank: issue.rank }).from(issue).where(eq(issue.projectId, projectId)).orderBy(desc(issue.rank)).limit(1);
  return last?.rank ?? null;
}

// ---------- commands ----------

export async function createIssue(tx: Tx, actorId: string, input: IssueCreateInput, source: Source = "user") {
  const [p] = await tx
    .update(project)
    .set({ issueCounter: sql`${project.issueCounter} + 1` })
    .where(and(eq(project.id, input.projectId), isNull(project.archivedAt)))
    .returning({ id: project.id, number: project.issueCounter });
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found or archived." });

  const status = input.statusId
    ? await getStatus(tx, p.id, input.statusId)
    : (await tx.select().from(workflowStatus).where(eq(workflowStatus.projectId, p.id)).orderBy(asc(workflowStatus.position)).limit(1))[0];
  await assertUser(tx, input.assigneeId);
  await assertParent(tx, p.id, input.parentId);
  await assertLabels(tx, p.id, input.labelIds ?? []);
  await assertSprint(tx, p.id, input.sprintId);
  await assertRelease(tx, p.id, input.releaseId);

  const [row] = await tx
    .insert(issue)
    .values({
      projectId: p.id,
      number: p.number,
      type: input.type,
      title: input.title,
      description: input.description ?? "",
      statusId: status.id,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      reporterId: actorId,
      parentId: input.parentId ?? null,
      estimate: input.estimate ?? null,
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      sprintId: input.sprintId ?? null,
      releaseId: input.releaseId ?? null,
      triage: input.triage ?? false,
      source: source === "user" ? "web" : source,
      rank: generateKeyBetween(await lastRank(tx, p.id), null),
      resolvedAt: status.category === "done" ? new Date() : null,
    })
    .returning();

  if (input.labelIds?.length) await tx.insert(issueLabel).values(input.labelIds.map((labelId) => ({ issueId: row.id, labelId })));
  await watch(tx, row.id, [actorId, row.assigneeId]);

  const act = await logActivity(tx, { actorId, projectId: p.id, issueId: row.id, verb: "created", source });
  if (source === "import") return row; // bulk imports don't notify anyone
  const recipients = new Map<string, Reason>();
  for (const id of parseMentions(row.description)) recipients.set(id, "mentioned");
  if (row.assigneeId) recipients.set(row.assigneeId, "assigned");
  await notify(tx, p.id, act.id, actorId, recipients);
  return row;
}

const TRACKED = [
  "title",
  "description",
  "type",
  "statusId",
  "priority",
  "assigneeId",
  "parentId",
  "estimate",
  "dueDate",
  "startDate",
  "sprintId",
  "releaseId",
  "triage",
] as const;

export async function updateIssue(tx: Tx, actorId: string, input: IssueUpdateInput, source: Source = "user") {
  const [cur] = await tx.select().from(issue).where(and(eq(issue.id, input.id), isNull(issue.deletedAt))).for("update");
  if (!cur) throw new TRPCError({ code: "NOT_FOUND" });

  const patch: Partial<typeof issue.$inferInsert> = {};
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of TRACKED) {
    const v = input[k];
    if (v !== undefined && v !== cur[k]) {
      (patch as Record<string, unknown>)[k] = v;
      diff[k] = { from: cur[k], to: v };
    }
  }

  if (patch.statusId) {
    const [next, prev] = await Promise.all([getStatus(tx, cur.projectId, patch.statusId), getStatus(tx, cur.projectId, cur.statusId)]);
    await assertTransition(tx, cur, next.id, next.category);
    if (next.category === "done" && prev.category !== "done") patch.resolvedAt = new Date();
    if (next.category !== "done") patch.resolvedAt = null;
    patch.statusChangedAt = new Date();
    if (!cur.firstResponseAt) patch.firstResponseAt = new Date();
  }
  if (patch.assigneeId) await assertUser(tx, patch.assigneeId);
  if (patch.parentId) await assertParent(tx, cur.projectId, patch.parentId, cur.id);
  if (patch.sprintId) await assertSprint(tx, cur.projectId, patch.sprintId);
  if (patch.releaseId) await assertRelease(tx, cur.projectId, patch.releaseId);
  if (input.rank) patch.rank = input.rank;

  if (input.labelIds) {
    await assertLabels(tx, cur.projectId, input.labelIds);
    const before = (await tx.select({ id: issueLabel.labelId }).from(issueLabel).where(eq(issueLabel.issueId, cur.id))).map((r) => r.id);
    if (before.sort().join() !== [...input.labelIds].sort().join()) {
      await tx.delete(issueLabel).where(eq(issueLabel.issueId, cur.id));
      if (input.labelIds.length) await tx.insert(issueLabel).values(input.labelIds.map((labelId) => ({ issueId: cur.id, labelId })));
      diff.labels = { from: before, to: input.labelIds };
    }
  }

  if (!Object.keys(patch).length && !diff.labels) return cur;
  const [row] = await tx.update(issue).set({ ...patch, updatedAt: new Date() }).where(eq(issue.id, cur.id)).returning();

  // Pure reorders (rank only) are not history-worthy.
  if (!Object.keys(diff).length) return row;
  const act = await logActivity(tx, { actorId, projectId: cur.projectId, issueId: cur.id, verb: "updated", diff, source });
  const recipients = new Map<string, Reason>();
  for (const id of await watchers(tx, cur.id)) recipients.set(id, "watching");
  if (diff.description) for (const id of parseMentions(String(diff.description.to))) recipients.set(id, "mentioned");
  if (diff.assigneeId && row.assigneeId) recipients.set(row.assigneeId, "assigned");
  await notify(tx, cur.projectId, act.id, actorId, recipients);
  await watch(tx, cur.id, [row.assigneeId]);
  return row;
}

/**
 * Drag & drop. Rank is one global order per project, so any filtered view (a board column, the
 * backlog, a sprint) is a sorted subsequence and its neighbours give a valid slot.
 */
export async function moveIssue(
  tx: Tx,
  actorId: string,
  input: { id: string; statusId?: string; sprintId?: string | null; afterId: string | null; beforeId: string | null },
) {
  const [cur] = await tx.select({ projectId: issue.projectId }).from(issue).where(eq(issue.id, input.id));
  if (!cur) throw new TRPCError({ code: "NOT_FOUND" });
  const ids = [input.afterId, input.beforeId].filter((x): x is string => !!x);
  const neighbours = ids.length
    ? await tx.select({ id: issue.id, rank: issue.rank }).from(issue).where(and(inArray(issue.id, ids), eq(issue.projectId, cur.projectId)))
    : [];
  const above = neighbours.find((n) => n.id === input.afterId)?.rank ?? null;
  let below = neighbours.find((n) => n.id === input.beforeId)?.rank ?? null;
  if (above !== null && below !== null && above >= below) below = null; // stale client view; fall back to "after above"
  const rank = above === null && below === null ? generateKeyBetween(await lastRank(tx, cur.projectId), null) : generateKeyBetween(above, below);
  return updateIssue(tx, actorId, { id: input.id, statusId: input.statusId, sprintId: input.sprintId, rank });
}

export async function setDeleted(tx: Tx, actorId: string, id: string, deleted: boolean) {
  const [row] = await tx
    .update(issue)
    .set({ deletedAt: deleted ? new Date() : null })
    .where(and(eq(issue.id, id), deleted ? isNull(issue.deletedAt) : sql`${issue.deletedAt} is not null`))
    .returning();
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await logActivity(tx, { actorId, projectId: row.projectId, issueId: row.id, verb: deleted ? "deleted" : "restored" });
  return row;
}

export async function addComment(tx: Tx, actorId: string, issueId: string, body: string, opts: { parentId?: string | null; source?: Source } = {}) {
  const [i] = await tx
    .select({ id: issue.id, projectId: issue.projectId, reporterId: issue.reporterId, firstResponseAt: issue.firstResponseAt })
    .from(issue)
    .where(and(eq(issue.id, issueId), isNull(issue.deletedAt)));
  if (!i) throw new TRPCError({ code: "NOT_FOUND" });
  if (opts.parentId) {
    const [parent] = await tx.select({ issueId: comment.issueId }).from(comment).where(eq(comment.id, opts.parentId));
    if (parent?.issueId !== issueId) throw new TRPCError({ code: "BAD_REQUEST", message: "Reply target is on a different issue." });
  }
  const [c] = await tx.insert(comment).values({ issueId, authorId: actorId, body, parentId: opts.parentId ?? null }).returning();
  if (!i.firstResponseAt && actorId !== i.reporterId) await tx.update(issue).set({ firstResponseAt: new Date() }).where(eq(issue.id, issueId));
  const act = await logActivity(tx, {
    actorId,
    projectId: i.projectId,
    issueId,
    verb: "commented",
    source: opts.source ?? "user",
    diff: { comment: { from: null, to: body.slice(0, 280) } },
  });
  const recipients = new Map<string, Reason>();
  for (const id of await watchers(tx, issueId)) recipients.set(id, "watching");
  for (const id of parseMentions(body)) recipients.set(id, "mentioned");
  await notify(tx, i.projectId, act.id, actorId, recipients);
  await watch(tx, issueId, [actorId]);
  return c;
}
