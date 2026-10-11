import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { projectCreate } from "@/lib/validators";
import { issue, label, project, workflowStatus } from "../db/schema";
import { adminProcedure, authedProcedure, memberProcedure, router } from "../trpc";

const DEFAULT_STATUSES = [
  { name: "To Do", category: "todo", color: "slate" },
  { name: "In Progress", category: "in_progress", color: "blue" },
  { name: "In Review", category: "in_progress", color: "violet" },
  { name: "Testing", category: "in_progress", color: "amber" },
  { name: "Done", category: "done", color: "green" },
] as const;

export const projectRouter = router({
  list: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        // Explicit "project"."id": drizzle renders a bare "id" for single-table selects, which is ambiguous here.
        openIssues: sql<number>`(select count(*)::int from ${issue} i join ${workflowStatus} s on s.id = i.status_id
          where i.project_id = "project"."id" and i.deleted_at is null and s.category <> 'done')`,
      })
      .from(project)
      .where(isNull(project.archivedAt))
      .orderBy(asc(project.name)),
  ),

  byKey: authedProcedure.input(z.object({ key: z.string().toUpperCase() })).query(async ({ ctx, input }) => {
    const [p] = await ctx.db.select().from(project).where(eq(project.key, input.key));
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: `No project ${input.key}` });
    const [statuses, labels] = await Promise.all([
      ctx.db.select().from(workflowStatus).where(eq(workflowStatus.projectId, p.id)).orderBy(asc(workflowStatus.position)),
      ctx.db.select().from(label).where(eq(label.projectId, p.id)).orderBy(asc(label.name)),
    ]);
    return { ...p, statuses, labels };
  }),

  create: memberProcedure.input(projectCreate).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(project).where(eq(project.key, input.key));
      if (n) throw new TRPCError({ code: "CONFLICT", message: `Key ${input.key} is taken.` });
      const { method, ...fields } = input;
      const [p] = await tx.insert(project).values({ ...fields, settings: { method }, leadId: ctx.user.id }).returning();
      await tx.insert(workflowStatus).values(DEFAULT_STATUSES.map((s, position) => ({ ...s, position, projectId: p.id })));
      return p;
    }),
  ),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80).optional(), description: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input: { id, ...patch } }) => {
      const [p] = await ctx.db.update(project).set(patch).where(eq(project.id, id)).returning();
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return p;
    }),

  archive: adminProcedure.input(z.object({ id: z.string().uuid(), archived: z.boolean() })).mutation(async ({ ctx, input }) => {
    await ctx.db.update(project).set({ archivedAt: input.archived ? new Date() : null }).where(eq(project.id, input.id));
  }),

  createLabel: memberProcedure
    .input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(40), color: z.string().max(20).default("slate") }))
    .mutation(async ({ ctx, input }) => {
      const [l] = await ctx.db.insert(label).values(input).onConflictDoNothing().returning();
      if (l) return l;
      const [existing] = await ctx.db.select().from(label).where(and(eq(label.projectId, input.projectId), eq(label.name, input.name)));
      return existing;
    }),
});
