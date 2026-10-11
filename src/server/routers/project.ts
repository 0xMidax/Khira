import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { projectCreate } from "@/lib/validators";
import { scope } from "../access";
import { issue, label, project, projectMember, user, workflowStatus } from "../db/schema";
import { adminProcedure, authedProcedure, memberProcedure, router } from "../trpc";

const DEFAULT_STATUSES = [
  { name: "To Do", category: "todo", color: "slate" },
  { name: "In Progress", category: "in_progress", color: "blue" },
  { name: "In Review", category: "in_progress", color: "violet" },
  { name: "Testing", category: "in_progress", color: "amber" },
  { name: "Done", category: "done", color: "green" },
] as const;

export const projectRouter = router({
  list: authedProcedure.query(async ({ ctx }) =>
    ctx.db
      .select({
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        visibility: project.visibility,
        // Explicit "project"."id": drizzle renders a bare "id" for single-table selects, which is ambiguous here.
        openIssues: sql<number>`(select count(*)::int from ${issue} i join ${workflowStatus} s on s.id = i.status_id
          where i.project_id = "project"."id" and i.deleted_at is null and s.category <> 'done')`,
      })
      .from(project)
      .where(and(isNull(project.archivedAt), scope(await ctx.access(), project.id)))
      .orderBy(asc(project.name)),
  ),

  byKey: authedProcedure.input(z.object({ key: z.string().toUpperCase() })).query(async ({ ctx, input }) => {
    const [p] = await ctx.db.select().from(project).where(eq(project.key, input.key));
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: `No project ${input.key}` });
    const myRole = await ctx.requireProject(p.id, "read");
    const [statuses, labels] = await Promise.all([
      ctx.db.select().from(workflowStatus).where(eq(workflowStatus.projectId, p.id)).orderBy(asc(workflowStatus.position)),
      ctx.db.select().from(label).where(eq(label.projectId, p.id)).orderBy(asc(label.name)),
    ]);
    return { ...p, statuses, labels, myRole };
  }),

  create: memberProcedure.input(projectCreate).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(project).where(eq(project.key, input.key));
      if (n) throw new TRPCError({ code: "CONFLICT", message: `Key ${input.key} is taken.` });
      const { method, ...fields } = input;
      const [p] = await tx.insert(project).values({ ...fields, settings: { method }, leadId: ctx.user.id }).returning();
      await tx.insert(workflowStatus).values(DEFAULT_STATUSES.map((s, position) => ({ ...s, position, projectId: p.id })));
      // The creator manages the project, including if it is made private later.
      await tx.insert(projectMember).values({ projectId: p.id, userId: ctx.user.id, role: "admin" });
      return p;
    }),
  ),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80).optional(), description: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input: { id, ...patch } }) => {
      await ctx.requireProject(id, "admin");
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
      await ctx.requireProject(input.projectId, "write");
      const [l] = await ctx.db.insert(label).values(input).onConflictDoNothing().returning();
      if (l) return l;
      const [existing] = await ctx.db.select().from(label).where(and(eq(label.projectId, input.projectId), eq(label.name, input.name)));
      return existing;
    }),
  // ---------- Access: visibility & members (project admins) ----------

  members: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    return ctx.db
      .select({ userId: projectMember.userId, role: projectMember.role, name: user.name, email: user.email, image: user.image, workspaceRole: user.role })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(eq(projectMember.projectId, input.projectId))
      .orderBy(asc(user.name));
  }),

  setVisibility: memberProcedure
    .input(z.object({ projectId: z.string().uuid(), visibility: z.enum(["open", "private"]) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.requireProject(input.projectId, "admin");
      if (input.visibility === "private") {
        // Making it private must not lock out the person doing it.
        await ctx.db.insert(projectMember).values({ projectId: input.projectId, userId: ctx.user.id, role: "admin" }).onConflictDoNothing();
      }
      await ctx.db.update(project).set({ visibility: input.visibility }).where(eq(project.id, input.projectId));
    }),

  setMember: memberProcedure
    .input(z.object({ projectId: z.string().uuid(), userId: z.string().min(1), role: z.enum(["admin", "member", "viewer"]) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.requireProject(input.projectId, "admin");
      const [u] = await ctx.db.select({ id: user.id }).from(user).where(and(eq(user.id, input.userId), isNull(user.deactivatedAt)));
      if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown or deactivated user." });
      await ctx.db
        .insert(projectMember)
        .values(input)
        .onConflictDoUpdate({ target: [projectMember.projectId, projectMember.userId], set: { role: input.role } });
    }),

  removeMember: memberProcedure.input(z.object({ projectId: z.string().uuid(), userId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "admin");
    const admins = await ctx.db
      .select({ userId: projectMember.userId })
      .from(projectMember)
      .where(and(eq(projectMember.projectId, input.projectId), eq(projectMember.role, "admin")));
    if (admins.length === 1 && admins[0].userId === input.userId)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Make someone else a project admin first." });
    await ctx.db.delete(projectMember).where(and(eq(projectMember.projectId, input.projectId), eq(projectMember.userId, input.userId)));
  }),
});
