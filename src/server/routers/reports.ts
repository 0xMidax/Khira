import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { activity, issue, project, sprint, user, workflowStatus, worklog } from "../db/schema";
import { scope as reachable } from "../access";
import { authedProcedure, memberProcedure, router } from "../trpc";

const id = z.string().uuid();
// ponytail: report days are UTC days; switch to per-viewer time zones if the team spans far-apart zones.
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Each issue's status timeline from the activity log: [{at, statusId}] starting at creation. */
export async function statusTimelines(db: typeof import("../db").db, projectId: string) {
  const [issues, changes] = await Promise.all([
    db
      .select({ id: issue.id, statusId: issue.statusId, createdAt: issue.createdAt, deletedAt: issue.deletedAt, resolvedAt: issue.resolvedAt })
      .from(issue)
      .where(eq(issue.projectId, projectId)),
    db
      .select({ issueId: activity.issueId, diff: activity.diff, at: activity.createdAt })
      .from(activity)
      .where(and(eq(activity.projectId, projectId), eq(activity.verb, "updated"), sql`${activity.diff} ? 'statusId'`))
      .orderBy(asc(activity.createdAt)),
  ]);
  const byIssue = new Map<string, { at: Date; from: string; to: string }[]>();
  for (const c of changes) {
    if (!c.issueId) continue;
    const list = byIssue.get(c.issueId) ?? [];
    list.push({ at: c.at, from: String(c.diff!.statusId.from), to: String(c.diff!.statusId.to) });
    byIssue.set(c.issueId, list);
  }
  return issues.map((i) => {
    const ch = byIssue.get(i.id) ?? [];
    const timeline = [{ at: i.createdAt, statusId: ch[0]?.from ?? i.statusId }, ...ch.map((c) => ({ at: c.at, statusId: c.to }))];
    return { ...i, timeline };
  });
}

export const statusAt = (timeline: { at: Date; statusId: string }[], t: Date) => {
  let s: string | null = null;
  for (const e of timeline) if (e.at <= t) s = e.statusId;
  return s;
};

export const reportsRouter = router({
  /** Cumulative flow: issues per status for each of the last `days` days. */
  cfd: authedProcedure.input(z.object({ projectId: id, days: z.number().int().min(7).max(180).default(30) })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    const [statuses, issues] = await Promise.all([
      ctx.db.select().from(workflowStatus).where(eq(workflowStatus.projectId, input.projectId)).orderBy(asc(workflowStatus.position)),
      statusTimelines(ctx.db, input.projectId),
    ]);
    const today = new Date();
    const points = [];
    for (let d = input.days - 1; d >= 0; d--) {
      const end = new Date(today.getTime() - d * DAY);
      end.setUTCHours(23, 59, 59, 999);
      const counts: Record<string, number> = Object.fromEntries(statuses.map((s) => [s.id, 0]));
      for (const i of issues) {
        if (i.createdAt > end || (i.deletedAt && i.deletedAt <= end)) continue;
        const s = statusAt(i.timeline, end);
        if (s && s in counts) counts[s]++;
      }
      points.push({ date: dayKey(end), ...counts });
    }
    return { statuses: statuses.map((s) => ({ id: s.id, name: s.name, color: s.color })), points };
  }),

  /** Cycle time = first move into an in-progress status → resolved. Lead time = created → resolved. */
  cycleTime: authedProcedure.input(z.object({ projectId: id, days: z.number().int().min(7).max(365).default(90) })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    const since = new Date(Date.now() - input.days * DAY);
    const [statuses, issues] = await Promise.all([
      ctx.db.select({ id: workflowStatus.id, category: workflowStatus.category }).from(workflowStatus).where(eq(workflowStatus.projectId, input.projectId)),
      statusTimelines(ctx.db, input.projectId),
    ]);
    const inProgress = new Set(statuses.filter((s) => s.category === "in_progress").map((s) => s.id));
    const rows = issues
      .filter((i) => i.resolvedAt && i.resolvedAt >= since && !i.deletedAt)
      .map((i) => {
        const started = i.timeline.find((e) => inProgress.has(e.statusId))?.at ?? i.createdAt;
        return {
          id: i.id,
          resolvedAt: i.resolvedAt!,
          cycleDays: Math.max(0, (i.resolvedAt!.getTime() - started.getTime()) / DAY),
          leadDays: (i.resolvedAt!.getTime() - i.createdAt.getTime()) / DAY,
        };
      });
    const cyc = rows.map((r) => r.cycleDays).sort((a, b) => a - b);
    const lead = rows.map((r) => r.leadDays).sort((a, b) => a - b);
    return {
      count: rows.length,
      cycle: { p50: percentile(cyc, 50), p85: percentile(cyc, 85) },
      lead: { p50: percentile(lead, 50), p85: percentile(lead, 85) },
      points: rows.map((r) => ({ date: dayKey(r.resolvedAt), cycleDays: Math.round(r.cycleDays * 10) / 10 })),
    };
  }),

  createdVsResolved: authedProcedure
    .input(z.object({ projectId: id.optional(), days: z.number().int().min(7).max(180).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - (input.days - 1) * DAY);
      since.setUTCHours(0, 0, 0, 0);
      if (input.projectId) await ctx.requireProject(input.projectId, "read");
      const scope = input.projectId ? eq(issue.projectId, input.projectId) : reachable(await ctx.access());
      const [created, resolved] = await Promise.all([
        ctx.db
          .select({ day: sql<string>`to_char(${issue.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
          .from(issue)
          .where(and(scope, isNull(issue.deletedAt), gte(issue.createdAt, since)))
          .groupBy(sql`1`),
        ctx.db
          .select({ day: sql<string>`to_char(${issue.resolvedAt} at time zone 'UTC', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
          .from(issue)
          .where(and(scope, isNull(issue.deletedAt), gte(issue.resolvedAt, since)))
          .groupBy(sql`1`),
      ]);
      const c = new Map(created.map((r) => [r.day, r.n]));
      const r = new Map(resolved.map((x) => [x.day, x.n]));
      return Array.from({ length: input.days }, (_, i) => {
        const day = dayKey(new Date(since.getTime() + i * DAY));
        return { date: day, created: c.get(day) ?? 0, resolved: r.get(day) ?? 0 };
      });
    }),

  /** Open work per person: issues and points, optionally limited to a sprint. */
  workload: authedProcedure.input(z.object({ projectId: id.optional(), sprintId: id.optional() })).query(async ({ ctx, input }) => {
    if (input.projectId) await ctx.requireProject(input.projectId, "read");
    return ctx.db
      .select({
        userId: issue.assigneeId,
        name: sql<string>`coalesce(${user.name}, 'Unassigned')`,
        image: user.image,
        issues: sql<number>`count(*)::int`,
        points: sql<number>`coalesce(sum(${issue.estimate}), 0)::int`,
        inProgress: sql<number>`(count(*) filter (where ${workflowStatus.category} = 'in_progress'))::int`,
        overdue: sql<number>`(count(*) filter (where ${issue.dueDate} < current_date))::int`,
      })
      .from(issue)
      .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
      .innerJoin(project, eq(project.id, issue.projectId))
      .leftJoin(user, eq(user.id, issue.assigneeId))
      .where(
        and(
          isNull(issue.deletedAt),
          isNull(project.archivedAt),
          sql`${workflowStatus.category} <> 'done'`,
          input.projectId ? eq(issue.projectId, input.projectId) : undefined,
          input.sprintId ? eq(issue.sprintId, input.sprintId) : undefined,
          reachable(await ctx.access()),
        ),
      )
      .groupBy(issue.assigneeId, user.name, user.image)
      .orderBy(desc(sql`count(*)`));
  }),

  /** Points per person per sprint for the heatmap (last 6 sprints + open ones). */
  heatmap: authedProcedure.input(z.object({ projectId: id })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    const sprints = await ctx.db
      .select({ id: sprint.id, name: sprint.name, state: sprint.state })
      .from(sprint)
      .where(eq(sprint.projectId, input.projectId))
      .orderBy(desc(sprint.createdAt))
      .limit(8);
    if (!sprints.length) return { sprints: [], people: [], cells: [] };
    const cells = await ctx.db
      .select({
        sprintId: issue.sprintId,
        userId: issue.assigneeId,
        name: sql<string>`coalesce(${user.name}, 'Unassigned')`,
        points: sql<number>`coalesce(sum(coalesce(${issue.estimate}, 1)), 0)::int`,
      })
      .from(issue)
      .leftJoin(user, eq(user.id, issue.assigneeId))
      .where(and(inArray(issue.sprintId, sprints.map((s) => s.id)), isNull(issue.deletedAt)))
      .groupBy(issue.sprintId, issue.assigneeId, user.name);
    const people = [...new Map(cells.map((c) => [c.userId ?? "none", { id: c.userId, name: c.name }])).values()];
    return { sprints: sprints.reverse(), people, cells };
  }),
});

// ---------- Time tracking ----------

export const timeRouter = router({
  log: memberProcedure
    .input(z.object({ issueId: id, minutes: z.number().int().min(1).max(24 * 60), note: z.string().max(500).optional(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.requireIssue(input.issueId, "write");
      const [i] = await ctx.db.select({ id: issue.id }).from(issue).where(and(eq(issue.id, input.issueId), isNull(issue.deletedAt)));
      if (!i) throw new TRPCError({ code: "NOT_FOUND" });
      const [w] = await ctx.db
        .insert(worklog)
        .values({ issueId: input.issueId, userId: ctx.user.id, minutes: input.minutes, note: input.note, day: input.day ?? dayKey(new Date()) })
        .returning();
      return w;
    }),

  forIssue: authedProcedure.input(z.object({ issueId: id })).query(async ({ ctx, input }) => {
    await ctx.requireIssue(input.issueId, "read");
    return ctx.db
      .select({ id: worklog.id, minutes: worklog.minutes, note: worklog.note, day: worklog.day, userId: worklog.userId, userName: user.name })
      .from(worklog)
      .innerJoin(user, eq(user.id, worklog.userId))
      .where(eq(worklog.issueId, input.issueId))
      .orderBy(desc(worklog.day), desc(worklog.createdAt));
  }),

  remove: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const [entry] = await ctx.db.select({ issueId: worklog.issueId }).from(worklog).where(eq(worklog.id, input.id));
    if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
    await ctx.requireIssue(entry.issueId, "write");
    const own = ctx.user.role === "admin" ? undefined : eq(worklog.userId, ctx.user.id);
    const [w] = await ctx.db.delete(worklog).where(and(eq(worklog.id, input.id), own)).returning();
    if (!w) throw new TRPCError({ code: "FORBIDDEN", message: "You can only remove your own time." });
  }),

  /** Timesheet: minutes per person per issue per day in a date range. */
  timesheet: authedProcedure
    .input(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), userId: z.string().optional() }))
    .query(async ({ ctx, input }) =>
      ctx.db
        .select({
          day: worklog.day,
          minutes: sql<number>`sum(${worklog.minutes})::int`,
          userId: worklog.userId,
          userName: user.name,
          issueKey: sql<string>`${project.key} || '-' || ${issue.number}`,
          issueTitle: issue.title,
        })
        .from(worklog)
        .innerJoin(user, eq(user.id, worklog.userId))
        .innerJoin(issue, eq(issue.id, worklog.issueId))
        .innerJoin(project, eq(project.id, issue.projectId))
        .where(
          and(
            gte(worklog.day, input.from),
            sql`${worklog.day} <= ${input.to}`,
            input.userId ? eq(worklog.userId, input.userId) : undefined,
            reachable(await ctx.access()),
          ),
        )
        .groupBy(worklog.day, worklog.userId, user.name, project.key, issue.number, issue.title)
        .orderBy(asc(worklog.day)),
    ),
});
