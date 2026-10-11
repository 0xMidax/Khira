import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { KqlError } from "@/lib/kql";
import { issue, project, savedFilter, sprint, user, workflowStatus, workflowTransition } from "../db/schema";
import { type Access, scope } from "../access";
import { compileKql } from "../kql";
import { logActivity, write } from "../services/issues";
import { authedProcedure, memberProcedure, router } from "../trpc";

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const assignee = alias(user, "assignee");

export const queryColumns = {
  id: issue.id,
  key: sql<string>`${project.key} || '-' || ${issue.number}`,
  title: issue.title,
  type: issue.type,
  priority: issue.priority,
  statusId: issue.statusId,
  statusName: workflowStatus.name,
  statusCategory: workflowStatus.category,
  statusColor: workflowStatus.color,
  projectId: issue.projectId,
  projectKey: project.key,
  sprintId: issue.sprintId,
  rank: issue.rank,
  estimate: issue.estimate,
  dueDate: issue.dueDate,
  assigneeId: issue.assigneeId,
  assigneeName: assignee.name,
  assigneeImage: assignee.image,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
  resolvedAt: issue.resolvedAt,
};

/** Shared by search, saved filters, dashboards and the API. */
export async function runKql(db: typeof import("../db").db, kql: string, meId: string, access: Access, limit = 200) {
  let compiled;
  try {
    compiled = compileKql(kql, { meId, now: new Date() });
  } catch (e) {
    if (e instanceof KqlError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
  return db
    .select(queryColumns)
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
    .leftJoin(assignee, eq(assignee.id, issue.assigneeId))
    .where(and(isNull(issue.deletedAt), isNull(project.archivedAt), compiled.where, scope(access)))
    .orderBy(...compiled.orderBy)
    .limit(limit);
}

// ---------- KQL search & saved filters ----------

export const searchRouter = router({
  query: authedProcedure
    .input(z.object({ kql: z.string().max(2000), limit: z.number().int().min(1).max(1000).default(200) }))
    .query(async ({ ctx, input }) => runKql(ctx.db, input.kql, ctx.user.id, await ctx.access(), input.limit)),

  filters: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(savedFilter)
      .where(or(eq(savedFilter.ownerId, ctx.user.id), eq(savedFilter.shared, true)))
      .orderBy(asc(savedFilter.name)),
  ),

  saveFilter: memberProcedure
    .input(z.object({ id: id.optional(), name: z.string().trim().min(1).max(80), kql: z.string().max(2000), shared: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      await runKql(ctx.db, input.kql, ctx.user.id, await ctx.access(), 1); // validate before saving
      if (input.id) {
        const [f] = await ctx.db
          .update(savedFilter)
          .set({ name: input.name, kql: input.kql, shared: input.shared })
          .where(and(eq(savedFilter.id, input.id), eq(savedFilter.ownerId, ctx.user.id)))
          .returning();
        if (!f) throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own filters." });
        return f;
      }
      const [f] = await ctx.db.insert(savedFilter).values({ ...input, ownerId: ctx.user.id }).returning();
      return f;
    }),

  deleteFilter: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const own = ctx.user.role === "admin" ? undefined : eq(savedFilter.ownerId, ctx.user.id);
    await ctx.db.delete(savedFilter).where(and(eq(savedFilter.id, input.id), own));
  }),
});

// ---------- Sprints ----------

async function sprintOr404(db: typeof import("../db").db, sprintId: string) {
  const [s] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
  if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Sprint not found." });
  return s;
}

async function sprintPoints(db: typeof import("../db").db, sprintId: string) {
  const [r] = await db
    .select({
      total: sql<number>`coalesce(sum(${issue.estimate}), 0)::int`,
      done: sql<number>`coalesce(sum(${issue.estimate}) filter (where ${workflowStatus.category} = 'done'), 0)::int`,
    })
    .from(issue)
    .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
    .where(and(eq(issue.sprintId, sprintId), isNull(issue.deletedAt)));
  return r;
}

export const sprintRouter = router({
  list: authedProcedure.input(z.object({ projectId: id, includeClosed: z.boolean().default(false) })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    return ctx.db
      .select({
        sprint,
        issues: sql<number>`(select count(*)::int from ${issue} i where i.sprint_id = ${sprint.id} and i.deleted_at is null)`,
        points: sql<number>`(select coalesce(sum(i.estimate),0)::int from ${issue} i where i.sprint_id = ${sprint.id} and i.deleted_at is null)`,
      })
      .from(sprint)
      .where(and(eq(sprint.projectId, input.projectId), input.includeClosed ? undefined : ne(sprint.state, "closed")))
      .orderBy(sql`case ${sprint.state} when 'active' then 0 when 'planned' then 1 else 2 end`, asc(sprint.createdAt));
  }),

  create: memberProcedure
    .input(z.object({ projectId: id, name: z.string().trim().min(1).max(80).optional(), goal: z.string().max(500).optional(), startDate: day.optional(), endDate: day.optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.requireProject(input.projectId, "write");
      const [{ n }] = await ctx.db.select({ n: count() }).from(sprint).where(eq(sprint.projectId, input.projectId));
      const [p] = await ctx.db.select({ key: project.key }).from(project).where(eq(project.id, input.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      const [s] = await ctx.db
        .insert(sprint)
        .values({ ...input, name: input.name || `${p.key} Sprint ${n + 1}` })
        .returning();
      return s;
    }),

  update: memberProcedure
    .input(z.object({ id, name: z.string().trim().min(1).max(80).optional(), goal: z.string().max(500).nullable().optional(), startDate: day.nullable().optional(), endDate: day.nullable().optional() }))
    .mutation(async ({ ctx, input: { id: sprintId, ...patch } }) => {
      await ctx.requireProject((await sprintOr404(ctx.db, sprintId)).projectId, "write");
      const [s] = await ctx.db.update(sprint).set(patch).where(eq(sprint.id, sprintId)).returning();
      if (!s) throw new TRPCError({ code: "NOT_FOUND" });
      return s;
    }),

  start: memberProcedure
    .input(z.object({ id, startDate: day, endDate: day, goal: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      // Check access before opening the transaction (the check reads outside it).
      await ctx.requireProject((await sprintOr404(ctx.db, input.id)).projectId, "write");
      return write(ctx.db, async (tx) => {
        const [s] = await tx.select().from(sprint).where(eq(sprint.id, input.id)).for("update");
        if (!s) throw new TRPCError({ code: "NOT_FOUND" });
        if (s.state !== "planned") throw new TRPCError({ code: "BAD_REQUEST", message: "Only a planned sprint can be started." });
        if (input.endDate <= input.startDate) throw new TRPCError({ code: "BAD_REQUEST", message: "End date must be after the start date." });
        const [{ active }] = await tx.select({ active: count() }).from(sprint).where(and(eq(sprint.projectId, s.projectId), eq(sprint.state, "active")));
        if (active) throw new TRPCError({ code: "CONFLICT", message: "Complete the active sprint before starting another." });
        const [pts] = await tx
          .select({ total: sql<number>`coalesce(sum(${issue.estimate}),0)::int` })
          .from(issue)
          .where(and(eq(issue.sprintId, s.id), isNull(issue.deletedAt)));
        const [row] = await tx
          .update(sprint)
          .set({ state: "active", startDate: input.startDate, endDate: input.endDate, goal: input.goal ?? s.goal, startedAt: new Date(), committedPoints: pts.total })
          .where(eq(sprint.id, s.id))
          .returning();
        await logActivity(tx, { actorId: ctx.user.id, projectId: s.projectId, verb: "sprintStarted", diff: { sprint: { from: null, to: s.name } } });
        return row;
      });
    }),

  /** Close the sprint; unfinished issues go to `moveTo` (another open sprint) or the backlog (null). */
  complete: memberProcedure.input(z.object({ id, moveTo: id.nullable() })).mutation(async ({ ctx, input }) => {
    await ctx.requireProject((await sprintOr404(ctx.db, input.id)).projectId, "write");
    return write(ctx.db, async (tx) => {
      const [s] = await tx.select().from(sprint).where(eq(sprint.id, input.id)).for("update");
      if (!s || s.state !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Only the active sprint can be completed." });
      if (input.moveTo) {
        const [t] = await tx.select().from(sprint).where(eq(sprint.id, input.moveTo));
        if (!t || t.projectId !== s.projectId || t.state !== "planned") throw new TRPCError({ code: "BAD_REQUEST", message: "Move unfinished work to a planned sprint in this project." });
      }
      const [pts] = await tx
        .select({ done: sql<number>`coalesce(sum(${issue.estimate}) filter (where ${workflowStatus.category} = 'done'), 0)::int` })
        .from(issue)
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .where(and(eq(issue.sprintId, s.id), isNull(issue.deletedAt)));
      const unfinished = await tx
        .select({ id: issue.id })
        .from(issue)
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .where(and(eq(issue.sprintId, s.id), isNull(issue.deletedAt), ne(workflowStatus.category, "done")));
      if (unfinished.length)
        await tx
          .update(issue)
          .set({ sprintId: input.moveTo, updatedAt: new Date() })
          .where(inArray(issue.id, unfinished.map((u) => u.id)));
      const [row] = await tx.update(sprint).set({ state: "closed", closedAt: new Date(), completedPoints: pts.done }).where(eq(sprint.id, s.id)).returning();
      await logActivity(tx, {
        actorId: ctx.user.id,
        projectId: s.projectId,
        verb: "sprintCompleted",
        diff: { sprint: { from: s.name, to: null }, carriedOver: { from: null, to: unfinished.length } },
      });
      return { sprint: row, carriedOver: unfinished.length };
    });
  }),

  delete: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const s = await sprintOr404(ctx.db, input.id);
    await ctx.requireProject(s.projectId, "write");
    if (s.state !== "planned") throw new TRPCError({ code: "BAD_REQUEST", message: "Only planned sprints can be deleted." });
    await ctx.db.delete(sprint).where(eq(sprint.id, s.id)); // issues fall back to the backlog (FK set null)
  }),

  burndown: authedProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const s = await sprintOr404(ctx.db, input.id);
    await ctx.requireProject(s.projectId, "read");
    if (!s.startDate || !s.endDate) return { unit: "points" as const, days: [], ...(await sprintPoints(ctx.db, s.id)) };
    const issues = await ctx.db
      .select({ estimate: issue.estimate, resolvedAt: issue.resolvedAt })
      .from(issue)
      .where(and(eq(issue.sprintId, s.id), isNull(issue.deletedAt)));
    const usePoints = issues.some((i) => i.estimate);
    const weight = (i: { estimate: number | null }) => (usePoints ? (i.estimate ?? 0) : 1);
    const total = issues.reduce((n, i) => n + weight(i), 0);
    const start = new Date(`${s.startDate}T00:00:00Z`);
    const end = new Date(`${s.endDate}T00:00:00Z`);
    const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    const today = new Date();
    const days = [];
    for (let d = 0; d <= span; d++) {
      const date = new Date(start.getTime() + d * 86_400_000);
      const endOfDay = new Date(date.getTime() + 86_400_000 - 1);
      days.push({
        date: date.toISOString().slice(0, 10),
        ideal: Math.round((total * (1 - d / span)) * 10) / 10,
        remaining: date > today ? null : issues.filter((i) => !i.resolvedAt || i.resolvedAt > endOfDay).reduce((n, i) => n + weight(i), 0),
      });
    }
    return { unit: usePoints ? ("points" as const) : ("issues" as const), days, ...(await sprintPoints(ctx.db, s.id)) };
  }),

  velocity: authedProcedure.input(z.object({ projectId: id })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    return (
      await ctx.db
        .select({ name: sprint.name, committed: sprint.committedPoints, completed: sprint.completedPoints, closedAt: sprint.closedAt })
        .from(sprint)
        .where(and(eq(sprint.projectId, input.projectId), eq(sprint.state, "closed")))
        .orderBy(desc(sprint.closedAt))
        .limit(8)
    ).reverse();
  }),
});

// ---------- Workflow & project settings ----------

const settingsInput = z.object({
  method: z.enum(["scrum", "kanban"]).optional(),
  requireSubtasksDone: z.boolean().optional(),
  staleDays: z.number().int().min(0).max(365).optional(),
  sla: z
    .partialRecord(z.enum(["urgent", "high", "medium", "low"]), z.object({ responseHours: z.number().min(0).max(10_000), resolveHours: z.number().min(0).max(10_000) }))
    .optional(),
  github: z
    .object({
      repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(20).optional(),
      onBranchCreated: id.nullable().optional(),
      onPrOpened: id.nullable().optional(),
      onPrMerged: id.nullable().optional(),
      autoAssign: z.boolean().optional(),
    })
    .optional(),
});

export const workflowRouter = router({
  get: authedProcedure.input(z.object({ projectId: id })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    const [statuses, transitions, [p]] = await Promise.all([
      ctx.db
        .select({
          status: workflowStatus,
          issues: sql<number>`(select count(*)::int from ${issue} i where i.status_id = ${workflowStatus.id} and i.deleted_at is null)`,
        })
        .from(workflowStatus)
        .where(eq(workflowStatus.projectId, input.projectId))
        .orderBy(asc(workflowStatus.position)),
      ctx.db.select().from(workflowTransition).where(eq(workflowTransition.projectId, input.projectId)),
      ctx.db.select({ settings: project.settings }).from(project).where(eq(project.id, input.projectId)),
    ]);
    if (!p) throw new TRPCError({ code: "NOT_FOUND" });
    return { statuses, transitions, settings: p.settings };
  }),

  saveStatus: memberProcedure
    .input(
      z.object({
        projectId: id,
        id: id.optional(),
        name: z.string().trim().min(1).max(40),
        category: z.enum(["todo", "in_progress", "done"]),
        color: z.enum(["slate", "blue", "violet", "green", "amber", "red"]),
        wipLimit: z.number().int().min(1).max(999).nullable(),
      }),
    )
    .mutation(async ({ ctx, input: { id: statusId, projectId, ...fields } }) => {
      await ctx.requireProject(projectId, "admin");
      if (statusId) {
        const [s] = await ctx.db
          .update(workflowStatus)
          .set(fields)
          .where(and(eq(workflowStatus.id, statusId), eq(workflowStatus.projectId, projectId)))
          .returning();
        if (!s) throw new TRPCError({ code: "NOT_FOUND" });
        return s;
      }
      const [{ max }] = await ctx.db
        .select({ max: sql<number>`coalesce(max(${workflowStatus.position}), -1)::int` })
        .from(workflowStatus)
        .where(eq(workflowStatus.projectId, projectId));
      const [s] = await ctx.db.insert(workflowStatus).values({ ...fields, projectId, position: max + 1 }).returning();
      return s;
    }),

  reorder: memberProcedure.input(z.object({ projectId: id, order: z.array(id).min(1).max(30) })).mutation(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "admin");
    return ctx.db.transaction(async (tx) => {
      const existing = await tx.select({ id: workflowStatus.id }).from(workflowStatus).where(eq(workflowStatus.projectId, input.projectId));
      if (existing.length !== input.order.length || !existing.every((e) => input.order.includes(e.id)))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Send every status of the project exactly once." });
      for (const [position, sid] of input.order.entries()) await tx.update(workflowStatus).set({ position }).where(eq(workflowStatus.id, sid));
    });
  }),

  /** Delete a status, moving its issues to `moveTo` first. */
  deleteStatus: memberProcedure.input(z.object({ projectId: id, id, moveTo: id })).mutation(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "admin");
    return ctx.db.transaction(async (tx) => {
      const statuses = await tx.select().from(workflowStatus).where(eq(workflowStatus.projectId, input.projectId));
      const from = statuses.find((s) => s.id === input.id);
      const to = statuses.find((s) => s.id === input.moveTo);
      if (!from || !to || from.id === to.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a different status of this project to move issues to." });
      if (statuses.length <= 2) throw new TRPCError({ code: "BAD_REQUEST", message: "A workflow needs at least two statuses." });
      await tx
        .update(issue)
        .set({ statusId: to.id, resolvedAt: to.category === "done" ? sql`coalesce(${issue.resolvedAt}, now())` : null, statusChangedAt: new Date() })
        .where(eq(issue.statusId, from.id));
      await tx.delete(workflowStatus).where(eq(workflowStatus.id, from.id));
    });
  }),

  /** Replace the transition matrix. Empty list = everything allowed. */
  setTransitions: memberProcedure
    .input(z.object({ projectId: id, transitions: z.array(z.object({ from: id, to: id })).max(900) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.requireProject(input.projectId, "admin");
      return ctx.db.transaction(async (tx) => {
        const ids = new Set((await tx.select({ id: workflowStatus.id }).from(workflowStatus).where(eq(workflowStatus.projectId, input.projectId))).map((s) => s.id));
        if (!input.transitions.every((t) => ids.has(t.from) && ids.has(t.to) && t.from !== t.to))
          throw new TRPCError({ code: "BAD_REQUEST", message: "Transitions must connect two different statuses of this project." });
        await tx.delete(workflowTransition).where(eq(workflowTransition.projectId, input.projectId));
        if (input.transitions.length)
          await tx.insert(workflowTransition).values(input.transitions.map((t) => ({ projectId: input.projectId, fromStatusId: t.from, toStatusId: t.to })));
      });
    }),

  updateSettings: memberProcedure.input(z.object({ projectId: id, settings: settingsInput })).mutation(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "admin");
    const [p] = await ctx.db.select({ settings: project.settings }).from(project).where(eq(project.id, input.projectId));
    if (!p) throw new TRPCError({ code: "NOT_FOUND" });
    const [row] = await ctx.db
      .update(project)
      .set({ settings: { ...p.settings, ...input.settings } })
      .where(eq(project.id, input.projectId))
      .returning({ settings: project.settings });
    return row.settings;
  }),
});

