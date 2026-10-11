import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { issueCreate, issueKey, issueListFilter, issueMove, issueUpdate } from "@/lib/validators";
import { activity, issue, issueLabel, label, project, user, workflowStatus } from "../db/schema";
import { createIssue, moveIssue, setDeleted, updateIssue, write } from "../services/issues";
import { scope } from "../access";
import { authedProcedure, memberProcedure, router } from "../trpc";

const assignee = alias(user, "assignee");
const reporter = alias(user, "reporter");

const listColumns = {
  id: issue.id,
  number: issue.number,
  key: sql<string>`${project.key} || '-' || ${issue.number}`,
  title: issue.title,
  type: issue.type,
  priority: issue.priority,
  statusId: issue.statusId,
  rank: issue.rank,
  estimate: issue.estimate,
  dueDate: issue.dueDate,
  parentId: issue.parentId,
  sprintId: issue.sprintId,
  triage: issue.triage,
  assigneeId: issue.assigneeId,
  assigneeName: assignee.name,
  assigneeImage: assignee.image,
  updatedAt: issue.updatedAt,
  deletedAt: issue.deletedAt,
};

function textMatch(q: string): SQL {
  const n = Number(q.replace(/^.*-/, ""));
  return or(
    sql`${issue.search} @@ websearch_to_tsquery('english', ${q})`,
    ilike(issue.title, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
    Number.isInteger(n) && n > 0 && /^([A-Za-z][A-Za-z0-9]*-)?\d+$/.test(q) ? eq(issue.number, n) : undefined,
  )!;
}

async function withLabels<T extends { id: string }>(db: typeof import("../db").db, rows: T[]) {
  if (!rows.length) return rows.map((r) => ({ ...r, labels: [] as { id: string; name: string; color: string }[] }));
  const links = await db
    .select({ issueId: issueLabel.issueId, id: label.id, name: label.name, color: label.color })
    .from(issueLabel)
    .innerJoin(label, eq(label.id, issueLabel.labelId))
    .where(inArray(issueLabel.issueId, rows.map((r) => r.id)));
  return rows.map((r) => ({ ...r, labels: links.filter((l) => l.issueId === r.id).map(({ id, name, color }) => ({ id, name, color })) }));
}

const CATEGORY_ORDER = { todo: 0, in_progress: 1, done: 2 } as const;

/** Same-named statuses from different projects become one column; order by category, then average position. */
export function mergeColumns(rows: { name: string; category: "todo" | "in_progress" | "done"; color: string; position: number }[]) {
  const cols = new Map<string, { id: string; name: string; category: (typeof rows)[number]["category"]; color: string; positions: number[] }>();
  for (const r of rows) {
    const id = r.name.trim().toLowerCase();
    const c = cols.get(id) ?? { id, name: r.name, category: r.category, color: r.color, positions: [] };
    c.positions.push(r.position);
    cols.set(id, c);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return [...cols.values()]
    .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || avg(a.positions) - avg(b.positions))
    .map(({ positions: _p, ...c }) => c);
}

export const issueRouter = router({
  list: authedProcedure.input(issueListFilter).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    const where: (SQL | undefined)[] = [eq(issue.projectId, input.projectId)];
    if (!input.includeDeleted) where.push(isNull(issue.deletedAt));
    if (input.assigneeId === null) where.push(isNull(issue.assigneeId));
    else if (input.assigneeId) where.push(eq(issue.assigneeId, input.assigneeId));
    if (input.type) where.push(eq(issue.type, input.type));
    if (input.priority) where.push(eq(issue.priority, input.priority));
    if (input.sprintId) where.push(eq(issue.sprintId, input.sprintId));
    if (input.resolvedSince) where.push(or(isNull(issue.resolvedAt), gte(issue.resolvedAt, new Date(`${input.resolvedSince}T00:00:00Z`))));
    if (input.labelId) where.push(sql`exists (select 1 from ${issueLabel} where ${issueLabel.issueId} = ${issue.id} and ${issueLabel.labelId} = ${input.labelId})`);
    if (input.q?.trim()) where.push(textMatch(input.q.trim()));
    // ponytail: no pagination yet — fine for a small team's project (<~2k open issues). Add cursor paging past that.
    const rows = await ctx.db
      .select(listColumns)
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .leftJoin(assignee, eq(assignee.id, issue.assigneeId))
      .where(and(...where))
      .orderBy(asc(issue.rank))
      .limit(2000);
    return withLabels(ctx.db, rows);
  }),

  mine: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ ...listColumns, statusName: workflowStatus.name, statusCategory: workflowStatus.category, projectKey: project.key })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
      .leftJoin(assignee, eq(assignee.id, issue.assigneeId))
      .where(
        and(eq(issue.assigneeId, ctx.user.id), isNull(issue.deletedAt), sql`${workflowStatus.category} <> 'done'`, isNull(project.archivedAt), scope(await ctx.access())),
      )
      .orderBy(sql`case ${issue.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`, asc(issue.dueDate))
      .limit(200);
    return withLabels(ctx.db, rows);
  }),

  /** Cross-project board: every project's issues grouped by status category. Done shows only the last 14 days. */
  board: authedProcedure
    .input(z.object({ mine: z.boolean().default(false), projectIds: z.array(z.string().uuid()).max(50).optional() }))
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - 14 * 86_400_000);
      const rows = await ctx.db
        .select({
          ...listColumns,
          category: workflowStatus.category,
          statusName: workflowStatus.name,
          statusColor: workflowStatus.color,
          statusPosition: workflowStatus.position,
          projectKey: project.key,
        })
        .from(issue)
        .innerJoin(project, eq(project.id, issue.projectId))
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .leftJoin(assignee, eq(assignee.id, issue.assigneeId))
        .where(
          and(
            isNull(issue.deletedAt),
            isNull(project.archivedAt),
            eq(issue.triage, false),
            or(isNull(issue.resolvedAt), gte(issue.resolvedAt, since)),
            input.mine ? eq(issue.assigneeId, ctx.user.id) : undefined,
            input.projectIds?.length ? inArray(issue.projectId, input.projectIds) : undefined,
            scope(await ctx.access()),
          ),
        )
        // No shared rank across projects: urgent first, then most recently touched.
        .orderBy(sql`case ${issue.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`, desc(issue.updatedAt))
        .limit(1000);
      return withLabels(ctx.db, rows);
    }),

  /** Team board columns: every status name used by an active project, merged case-insensitively, in workflow order. */
  boardColumns: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ name: workflowStatus.name, category: workflowStatus.category, color: workflowStatus.color, position: workflowStatus.position })
      .from(workflowStatus)
      .innerJoin(project, eq(project.id, workflowStatus.projectId))
      .where(and(isNull(project.archivedAt), scope(await ctx.access(), workflowStatus.projectId)));
    return mergeColumns(rows);
  }),

  /** Move to a column of the team board: the status with that name in the issue's own project. */
  moveToStatus: memberProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.requireIssue(input.id, "write");
      const [i] = await ctx.db
        .select({ projectId: issue.projectId, projectKey: project.key, statusName: workflowStatus.name })
        .from(issue)
        .innerJoin(project, eq(project.id, issue.projectId))
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .where(and(eq(issue.id, input.id), isNull(issue.deletedAt)));
      if (!i) throw new TRPCError({ code: "NOT_FOUND" });
      if (i.statusName.toLowerCase() === input.name.toLowerCase()) return null;
      const [target] = await ctx.db
        .select({ id: workflowStatus.id })
        .from(workflowStatus)
        .where(and(eq(workflowStatus.projectId, i.projectId), sql`lower(${workflowStatus.name}) = ${input.name.toLowerCase()}`));
      if (!target) throw new TRPCError({ code: "BAD_REQUEST", message: `${i.projectKey} has no “${input.name}” status. Add it in Project settings → Workflow.` });
      return write(ctx.db, (tx) => updateIssue(tx, ctx.user.id, { id: input.id, statusId: target.id }));
    }),

  byKey: authedProcedure.input(z.object({ key: issueKey })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({
        issue,
        projectKey: project.key,
        projectName: project.name,
        sla: sql<import("../db/schema").SlaTargets | null>`${project.settings}->'sla'`,
        status: workflowStatus,
        assignee: { id: assignee.id, name: assignee.name, image: assignee.image },
        reporter: { id: reporter.id, name: reporter.name, image: reporter.image },
      })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
      .leftJoin(assignee, eq(assignee.id, issue.assigneeId))
      .innerJoin(reporter, eq(reporter.id, issue.reporterId))
      .where(and(eq(project.key, input.key.key), eq(issue.number, input.key.number)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await ctx.requireProject(row.issue.projectId, "read");

    const [children, parent, labels] = await Promise.all([
      ctx.db
        .select({ ...listColumns, statusName: workflowStatus.name, statusCategory: workflowStatus.category })
        .from(issue)
        .innerJoin(project, eq(project.id, issue.projectId))
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .leftJoin(assignee, eq(assignee.id, issue.assigneeId))
        .where(and(eq(issue.parentId, row.issue.id), isNull(issue.deletedAt)))
        .orderBy(asc(issue.number)),
      row.issue.parentId
        ? ctx.db
            .select({ id: issue.id, title: issue.title, key: sql<string>`${project.key} || '-' || ${issue.number}` })
            .from(issue)
            .innerJoin(project, eq(project.id, issue.projectId))
            .where(eq(issue.id, row.issue.parentId))
            .then((r) => r[0] ?? null)
        : null,
      ctx.db
        .select({ id: label.id, name: label.name, color: label.color })
        .from(issueLabel)
        .innerJoin(label, eq(label.id, issueLabel.labelId))
        .where(eq(issueLabel.issueId, row.issue.id)),
    ]);
    return { ...row, assignee: row.assignee?.id ? row.assignee : null, children, parent, labels };
  }),

  activity: authedProcedure.input(z.object({ issueId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await ctx.requireIssue(input.issueId, "read");
    return ctx.db
      .select({ id: activity.id, verb: activity.verb, diff: activity.diff, createdAt: activity.createdAt, actorName: user.name })
      .from(activity)
      .innerJoin(user, eq(user.id, activity.actorId))
      .where(eq(activity.issueId, input.issueId))
      .orderBy(desc(activity.createdAt))
      .limit(200);
  }),

  /** ⌘K / global search across projects. */
  search: authedProcedure.input(z.object({ q: z.string().trim().min(1).max(200) })).query(async ({ ctx, input }) => {
    const exact = issueKey.safeParse(input.q);
    const match = exact.success ? and(eq(project.key, exact.data.key), eq(issue.number, exact.data.number)) : textMatch(input.q);
    return ctx.db
      .select({ id: issue.id, key: sql<string>`${project.key} || '-' || ${issue.number}`, title: issue.title, type: issue.type })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(and(isNull(issue.deletedAt), isNull(project.archivedAt), match, scope(await ctx.access())))
      .orderBy(desc(issue.updatedAt))
      .limit(10);
  }),

  create: memberProcedure.input(issueCreate).mutation(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "write");
    const row = await write(ctx.db, (tx) => createIssue(tx, ctx.user.id, input));
    const [p] = await ctx.db.select({ key: project.key }).from(project).where(eq(project.id, row.projectId));
    return { ...row, key: `${p.key}-${row.number}` };
  }),

  update: memberProcedure.input(issueUpdate.omit({ rank: true })).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(input.id, "write");
    return write(ctx.db, (tx) => updateIssue(tx, ctx.user.id, input));
  }),

  move: memberProcedure.input(issueMove).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(input.id, "write");
    return write(ctx.db, (tx) => moveIssue(tx, ctx.user.id, input));
  }),

  delete: memberProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(input.id, "write");
    return write(ctx.db, (tx) => setDeleted(tx, ctx.user.id, input.id, true));
  }),

  restore: memberProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(input.id, "write");
    return write(ctx.db, (tx) => setDeleted(tx, ctx.user.id, input.id, false));
  }),
});
