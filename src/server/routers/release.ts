import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { randomToken } from "@/lib/crypto";
import { issue, project, release, workflowStatus } from "../db/schema";
import { logActivity, write } from "../services/issues";
import { authedProcedure, memberProcedure, router } from "../trpc";

const id = z.string().uuid();

export async function releaseIssues(db: typeof import("../db").db, releaseId: string) {
  return db
    .select({
      id: issue.id,
      key: sql<string>`${project.key} || '-' || ${issue.number}`,
      title: issue.title,
      type: issue.type,
      statusCategory: workflowStatus.category,
    })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
    .where(and(eq(issue.releaseId, releaseId), isNull(issue.deletedAt)))
    .orderBy(asc(issue.type), asc(issue.number));
}

/** Plain changelog grouped by type — the AI writer can rewrite it, but this always works. */
export function draftNotes(name: string, items: { key: string; title: string; type: string; statusCategory: string }[]) {
  const done = items.filter((i) => i.statusCategory === "done");
  const groups: [string, string[]][] = [
    ["New", ["story", "epic", "task"]],
    ["Fixed", ["bug"]],
  ];
  const lines = [`# ${name}`, ""];
  for (const [heading, types] of groups) {
    const g = done.filter((i) => types.includes(i.type));
    if (!g.length) continue;
    lines.push(`## ${heading}`, ...g.map((i) => `- ${i.title} (${i.key})`), "");
  }
  if (!done.length) lines.push("_No finished issues in this release yet._");
  return lines.join("\n").trim();
}

async function releaseFor(
  ctx: { db: typeof import("../db").db; requireProject: (projectId: string, need: "read" | "write" | "admin") => Promise<unknown> },
  releaseId: string,
  need: "read" | "write",
) {
  const [r] = await ctx.db.select().from(release).where(eq(release.id, releaseId));
  if (!r) throw new TRPCError({ code: "NOT_FOUND" });
  await ctx.requireProject(r.projectId, need);
  return r;
}

export const releaseRouter = router({
  list: authedProcedure.input(z.object({ projectId: id })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    return ctx.db
      .select({
        release,
        total: sql<number>`(select count(*)::int from ${issue} i where i.release_id = ${release.id} and i.deleted_at is null)`,
        done: sql<number>`(select count(*)::int from ${issue} i join ${workflowStatus} s on s.id = i.status_id where i.release_id = ${release.id} and i.deleted_at is null and s.category = 'done')`,
      })
      .from(release)
      .where(eq(release.projectId, input.projectId))
      .orderBy(sql`${release.releasedAt} is not null`, desc(release.createdAt));
  }),

  get: authedProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const r = await releaseFor(ctx, input.id, "read");
    return { ...r, issues: await releaseIssues(ctx.db, r.id) };
  }),

  save: memberProcedure
    .input(z.object({ projectId: id, id: id.optional(), name: z.string().trim().min(1).max(60), description: z.string().max(2000).nullish(), releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }))
    .mutation(async ({ ctx, input: { id: rid, projectId, ...f } }) => {
      await ctx.requireProject(projectId, "write");
      if (rid) {
        const [r] = await ctx.db.update(release).set(f).where(and(eq(release.id, rid), eq(release.projectId, projectId))).returning();
        if (!r) throw new TRPCError({ code: "NOT_FOUND" });
        return r;
      }
      const [r] = await ctx.db.insert(release).values({ ...f, projectId }).onConflictDoNothing().returning();
      if (!r) throw new TRPCError({ code: "CONFLICT", message: "A release with that name already exists." });
      return r;
    }),

  setNotes: memberProcedure.input(z.object({ id, notes: z.string().max(50_000) })).mutation(async ({ ctx, input }) => {
    await releaseFor(ctx, input.id, "write");
    await ctx.db.update(release).set({ notes: input.notes }).where(eq(release.id, input.id));
  }),

  /** Mark released. Notes default to a generated changelog when empty. */
  ship: memberProcedure.input(z.object({ id, publish: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    const r = await releaseFor(ctx, input.id, "write");
    if (r.releasedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Already released." });
    // Read before the transaction: a second connection inside it would deadlock a single-connection DB.
    const notes = r.notes?.trim() ? r.notes : draftNotes(r.name, await releaseIssues(ctx.db, r.id));
    return write(ctx.db, async (tx) => {
      const [row] = await tx
        .update(release)
        .set({ releasedAt: new Date(), notes, publicSlug: input.publish ? (r.publicSlug ?? randomToken(10)) : r.publicSlug })
        .where(eq(release.id, r.id))
        .returning();
      await logActivity(tx, { actorId: ctx.user.id, projectId: r.projectId, verb: "released", diff: { release: { from: null, to: r.name } } });
      return row;
    });
  }),

  setPublic: memberProcedure.input(z.object({ id, public: z.boolean() })).mutation(async ({ ctx, input }) => {
    const r = await releaseFor(ctx, input.id, "write");
    const [row] = await ctx.db
      .update(release)
      .set({ publicSlug: input.public ? (r.publicSlug ?? randomToken(10)) : null })
      .where(eq(release.id, r.id))
      .returning();
    return row;
  }),

  delete: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    await releaseFor(ctx, input.id, "write");
    await ctx.db.delete(release).where(and(eq(release.id, input.id), isNull(release.releasedAt)));
  }),
});
