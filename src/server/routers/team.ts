import { TRPCError } from "@trpc/server";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { dashboard, type DashboardWidget, issue, project, retroItem, sprint, standup, user, workflowStatus } from "../db/schema";
import { createIssue, write } from "../services/issues";
import { runKql } from "./agile";
import { authedProcedure, memberProcedure, router } from "../trpc";

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const widget = z.object({
  id: z.string().max(40),
  type: z.enum(["count", "list", "byStatus", "byAssignee", "byPriority", "createdVsResolved"]),
  title: z.string().trim().min(1).max(80),
  kql: z.string().max(2000),
});

export const standupRouter = router({
  day: authedProcedure.input(z.object({ day })).query(({ ctx, input }) =>
    ctx.db
      .select({ id: standup.id, userId: standup.userId, name: user.name, image: user.image, content: standup.content, postedAt: standup.postedAt })
      .from(standup)
      .innerJoin(user, eq(user.id, standup.userId))
      .where(eq(standup.day, input.day))
      .orderBy(asc(user.name)),
  ),
  save: memberProcedure.input(z.object({ day, content: z.string().trim().min(1).max(5000) })).mutation(async ({ ctx, input }) => {
    const [s] = await ctx.db.select().from(standup).where(and(eq(standup.userId, ctx.user.id), eq(standup.day, input.day)));
    if (s?.postedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Already posted to Slack. Changes won't show there." });
    await ctx.db
      .insert(standup)
      .values({ userId: ctx.user.id, day: input.day, content: input.content })
      .onConflictDoUpdate({ target: [standup.userId, standup.day], set: { content: input.content } });
  }),
});

async function widgetData(db: typeof import("../db").db, w: DashboardWidget, meId: string) {
  const rows = await runKql(db, w.kql, meId, 1000);
  const group = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  switch (w.type) {
    case "count":
      return { count: rows.length };
    case "list":
      return { rows: rows.slice(0, 15) };
    case "byStatus":
      return { groups: group((r) => r.statusName) };
    case "byAssignee":
      return { groups: group((r) => r.assigneeName ?? "Unassigned") };
    case "byPriority":
      return { groups: group((r) => r.priority) };
    case "createdVsResolved": {
      const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10));
      return {
        series: days.map((d) => ({
          date: d,
          created: rows.filter((r) => r.createdAt.toISOString().slice(0, 10) === d).length,
          resolved: rows.filter((r) => r.resolvedAt?.toISOString().slice(0, 10) === d).length,
        })),
      };
    }
  }
}

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: "w1", type: "count", title: "Open and assigned to me", kql: "assignee = me() and category != done" },
  { id: "w2", type: "byStatus", title: "Open work by status", kql: "category != done" },
  { id: "w3", type: "byAssignee", title: "Open work by person", kql: "category != done" },
  { id: "w4", type: "list", title: "Urgent and high, still open", kql: "priority >= high and category != done order by priority desc, created" },
  { id: "w5", type: "createdVsResolved", title: "Created vs resolved (14 days)", kql: "created > -14d or resolved > -14d" },
  { id: "w6", type: "count", title: "Overdue", kql: "due < startOfDay() and category != done" },
];

export const dashboardRouter = router({
  list: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: dashboard.id, name: dashboard.name, shared: dashboard.shared, ownerId: dashboard.ownerId })
      .from(dashboard)
      .where(or(eq(dashboard.ownerId, ctx.user.id), eq(dashboard.shared, true)))
      .orderBy(asc(dashboard.name)),
  ),
  get: authedProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const [d] = await ctx.db.select().from(dashboard).where(and(eq(dashboard.id, input.id), or(eq(dashboard.ownerId, ctx.user.id), eq(dashboard.shared, true))));
    if (!d) throw new TRPCError({ code: "NOT_FOUND" });
    return d;
  }),
  create: memberProcedure.input(z.object({ name: z.string().trim().min(1).max(80) })).mutation(async ({ ctx, input }) => {
    const [d] = await ctx.db.insert(dashboard).values({ name: input.name, ownerId: ctx.user.id, widgets: DEFAULT_WIDGETS }).returning();
    return d;
  }),
  save: memberProcedure
    .input(z.object({ id, name: z.string().trim().min(1).max(80), shared: z.boolean(), widgets: z.array(widget).max(24) }))
    .mutation(async ({ ctx, input }) => {
      for (const w of input.widgets) await runKql(ctx.db, w.kql, ctx.user.id, 1); // validate each query
      const [d] = await ctx.db
        .update(dashboard)
        .set({ name: input.name, shared: input.shared, widgets: input.widgets })
        .where(and(eq(dashboard.id, input.id), eq(dashboard.ownerId, ctx.user.id)))
        .returning();
      if (!d) throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can edit a dashboard." });
      return d;
    }),
  delete: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(dashboard).where(and(eq(dashboard.id, input.id), eq(dashboard.ownerId, ctx.user.id)));
  }),
  widget: authedProcedure.input(widget).query(({ ctx, input }) => widgetData(ctx.db, input, ctx.user.id)),

  /** Timeline (epics & dated issues) and calendar (due dates) feed. */
  dated: authedProcedure
    .input(z.object({ projectId: id.optional(), from: day, to: day, epicsOnly: z.boolean().default(false) }))
    .query(({ ctx, input }) =>
      ctx.db
        .select({
          id: issue.id,
          key: sql<string>`${project.key} || '-' || ${issue.number}`,
          title: issue.title,
          type: issue.type,
          startDate: issue.startDate,
          dueDate: issue.dueDate,
          createdAt: issue.createdAt,
          statusCategory: workflowStatus.category,
          parentId: issue.parentId,
          projectKey: project.key,
          progress: sql<number>`(select coalesce(avg(case when s2.category = 'done' then 1.0 else 0 end), 0)::float from ${issue} c join ${workflowStatus} s2 on s2.id = c.status_id where c.parent_id = ${issue.id} and c.deleted_at is null)`,
        })
        .from(issue)
        .innerJoin(project, eq(project.id, issue.projectId))
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .where(
          and(
            sql`${issue.deletedAt} is null and ${project.archivedAt} is null`,
            input.projectId ? eq(issue.projectId, input.projectId) : undefined,
            input.epicsOnly ? eq(issue.type, "epic") : undefined,
            sql`coalesce(${issue.dueDate}, ${issue.startDate}) is not null`,
            sql`coalesce(${issue.startDate}, ${issue.dueDate}) <= ${input.to} and coalesce(${issue.dueDate}, ${issue.startDate}) >= ${input.from}`,
          ),
        )
        .orderBy(asc(sql`coalesce(${issue.startDate}, ${issue.dueDate})`))
        .limit(500),
    ),
});

export const retroRouter = router({
  items: authedProcedure.input(z.object({ sprintId: id })).query(({ ctx, input }) =>
    ctx.db
      .select({ item: retroItem, author: user.name, issueKey: sql<string | null>`(select p.key || '-' || i.number from ${issue} i join ${project} p on p.id = i.project_id where i.id = ${retroItem.issueId})` })
      .from(retroItem)
      .innerJoin(user, eq(user.id, retroItem.authorId))
      .where(eq(retroItem.sprintId, input.sprintId))
      .orderBy(asc(retroItem.createdAt)),
  ),
  add: memberProcedure
    .input(z.object({ sprintId: id, column: z.enum(["well", "improve", "action"]), body: z.string().trim().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const [s] = await ctx.db.select({ id: sprint.id }).from(sprint).where(eq(sprint.id, input.sprintId));
      if (!s) throw new TRPCError({ code: "NOT_FOUND" });
      const [r] = await ctx.db.insert(retroItem).values({ ...input, authorId: ctx.user.id }).returning();
      return r;
    }),
  vote: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    // Toggle my vote atomically in SQL so concurrent votes don't overwrite each other.
    await ctx.db
      .update(retroItem)
      .set({
        votes: sql`case when ${retroItem.votes} ? ${ctx.user.id} then ${retroItem.votes} - ${ctx.user.id}::text else ${retroItem.votes} || to_jsonb(${ctx.user.id}::text) end`,
      })
      .where(eq(retroItem.id, input.id));
  }),
  remove: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const own = ctx.user.role === "admin" ? undefined : eq(retroItem.authorId, ctx.user.id);
    const [r] = await ctx.db.delete(retroItem).where(and(eq(retroItem.id, input.id), own)).returning();
    if (!r) throw new TRPCError({ code: "FORBIDDEN", message: "You can only remove your own notes." });
  }),
  /** Turn an action item into a task in the sprint's project. */
  toIssue: memberProcedure.input(z.object({ id })).mutation(({ ctx, input }) =>
    write(ctx.db, async (tx) => {
      const [r] = await tx
        .select({ item: retroItem, projectId: sprint.projectId })
        .from(retroItem)
        .innerJoin(sprint, eq(sprint.id, retroItem.sprintId))
        .where(eq(retroItem.id, input.id));
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });
      if (r.item.issueId) throw new TRPCError({ code: "BAD_REQUEST", message: "Already turned into an issue." });
      const row = await createIssue(tx, ctx.user.id, { projectId: r.projectId, title: r.item.body.slice(0, 255), description: "From the sprint retrospective.", type: "task", priority: "none" });
      await tx.update(retroItem).set({ issueId: row.id }).where(eq(retroItem.id, r.item.id));
      return row;
    }),
  ),
});
