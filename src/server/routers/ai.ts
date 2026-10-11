import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { z as zod } from "zod";
import { KqlError, parseKql } from "@/lib/kql";
import { aiEnabled, prose, structured, z } from "../ai";
import { comment, issue, label, project, release, sprint, user, workflowStatus } from "../db/schema";
import { scope } from "../access";
import { BOT_ID } from "../services/bot";
import { draftNotes, releaseIssues } from "./release";
import { authedProcedure, memberProcedure, router } from "../trpc";

const id = zod.string().uuid();
const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
const TYPES = ["epic", "story", "task", "bug", "subtask"] as const;

async function teamContext(db: typeof import("../db").db, projectId: string) {
  const [people, labels] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(and(ne(user.id, BOT_ID), ne(user.role, "guest"))),
    db.select({ id: label.id, name: label.name }).from(label).where(eq(label.projectId, projectId)),
  ]);
  return { people, labels };
}

/** Words worth matching on: drops stop-words and anything that isn't a plain token. */
export function similarityQuery(text: string) {
  const STOP = new Set("the a an and or to of in on for with is are be when it this that from at by as not cant can't does doesnt don't".split(" "));
  const words = [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, 12);
  return words.join(" | ");
}

export const aiRouter = router({
  status: authedProcedure.query(() => ({ enabled: aiEnabled })),

  /** Messy notes → a structured issue draft the user reviews before saving. */
  draftIssue: memberProcedure.input(zod.object({ projectId: id, notes: zod.string().trim().min(3).max(20_000) })).mutation(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "write");
    const { people, labels } = await teamContext(ctx.db, input.projectId);
    const Draft = z.object({
      title: z.string().describe("Imperative, under 80 characters"),
      description: z.string().describe("Markdown: context, steps to reproduce for bugs, and a '### Acceptance criteria' checklist using '- [ ]'"),
      type: z.enum(TYPES),
      priority: z.enum(PRIORITIES),
      assigneeId: z.string().nullable().describe("Only an id from the team list, and only if the notes clearly point at someone"),
      labelNames: z.array(z.string()).describe("Only names from the label list"),
    });
    const draft = await structured(
      Draft,
      `Turn these notes into one well-formed issue. Team: ${JSON.stringify(people)}. Labels: ${JSON.stringify(labels.map((l) => l.name))}.`,
      input.notes,
      "medium",
    );
    // Never trust ids the model produced: keep only known ones.
    return {
      ...draft,
      title: draft.title.slice(0, 255),
      assigneeId: people.some((p) => p.id === draft.assigneeId) ? draft.assigneeId : null,
      labelIds: labels.filter((l) => draft.labelNames.some((n) => n.toLowerCase() === l.name.toLowerCase())).map((l) => l.id),
    };
  }),

  /** Break an epic into stories (returned for review, not created). */
  splitEpic: memberProcedure.input(zod.object({ issueId: id })).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(input.issueId, "write");
    const [i] = await ctx.db.select({ title: issue.title, description: issue.description }).from(issue).where(eq(issue.id, input.issueId));
    if (!i) throw new TRPCError({ code: "NOT_FOUND" });
    const Plan = z.object({
      stories: z
        .array(z.object({ title: z.string(), description: z.string(), estimate: z.number().int().min(1).max(13).describe("Story points, Fibonacci") }))
        .describe("3-8 independently shippable stories"),
    });
    return (await structured(Plan, "Split this epic into small, independently shippable stories.", `${i.title}\n\n${i.description}`, "medium")).stories;
  }),

  /** "bugs assigned to me due this week" → KQL (validated before returning). */
  toKql: authedProcedure.input(zod.object({ text: zod.string().trim().min(2).max(500) })).mutation(async ({ ctx, input }) => {
    const [projects, statuses, people, sprints] = await Promise.all([
      ctx.db.select({ key: project.key, name: project.name }).from(project).where(and(isNull(project.archivedAt), scope(await ctx.access(), project.id))),
      ctx.db.selectDistinct({ name: workflowStatus.name }).from(workflowStatus).where(scope(await ctx.access(), workflowStatus.projectId)),
      ctx.db.select({ name: user.name }).from(user).where(ne(user.id, BOT_ID)),
      ctx.db.select({ name: sprint.name }).from(sprint).where(and(ne(sprint.state, "closed"), scope(await ctx.access(), sprint.projectId))),
    ]);
    const guide = `KQL grammar: clauses "field op value" joined with AND/OR/NOT and parentheses, then optional "ORDER BY field ASC|DESC".
Fields: project, key, status, category (todo|in_progress|done), type (${TYPES.join("|")}), priority (${PRIORITIES.join("|")}; supports < > comparisons), assignee, reporter, label, sprint, release, parent, created, updated, due, resolved, estimate, text, title, triage (true|false).
Operators: = != > >= < <= ~ (contains) !~ in (a, b) "not in" "is empty" "is not empty".
Values: quote anything with spaces. Users: me() for the current user, or a name. Sprints: openSprints(), futureSprints(), or a name.
Dates: 2026-01-31, relative like -7d (7 days ago) or 7d (in 7 days), or startOfDay() endOfDay() startOfWeek() endOfWeek() startOfMonth() endOfMonth().
Today is ${new Date().toISOString().slice(0, 10)}.
Projects: ${JSON.stringify(projects)}. Statuses: ${JSON.stringify(statuses.map((s) => s.name))}. People: ${JSON.stringify(people.map((p) => p.name))}. Open sprints: ${JSON.stringify(sprints.map((s) => s.name))}.`;
    const Out = z.object({ kql: z.string(), explanation: z.string().describe("One short sentence in plain English") });
    const out = await structured(Out, `${guide}\n\nWrite the KQL query for the request below.`, input.text, "low", 2000);
    try {
      parseKql(out.kql);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Couldn't turn that into a valid query (${e instanceof KqlError ? e.message : "parse error"}). Try rephrasing.` });
    }
    return out;
  }),

  /** TL;DR of an issue's comment thread. */
  summarize: authedProcedure.input(zod.object({ issueId: id })).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(input.issueId, "read");
    const [i] = await ctx.db.select({ title: issue.title, description: issue.description }).from(issue).where(eq(issue.id, input.issueId));
    if (!i) throw new TRPCError({ code: "NOT_FOUND" });
    const cs = await ctx.db
      .select({ author: user.name, body: comment.body, at: comment.createdAt })
      .from(comment)
      .innerJoin(user, eq(user.id, comment.authorId))
      .where(and(eq(comment.issueId, input.issueId), isNull(comment.deletedAt)))
      .orderBy(comment.createdAt);
    if (cs.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "There isn't enough discussion to summarize yet." });
    const thread = cs.map((c) => `${c.author} (${c.at.toISOString().slice(0, 16)}): ${c.body}`).join("\n\n");
    return prose(
      "Summarize this issue discussion for someone catching up: 2-4 bullet points covering what was decided, what is still open, and who owns the next step. Markdown bullets only.",
      `Issue: ${i.title}\n${i.description}\n\nComments:\n${thread}`,
    );
  }),

  /** Suggest project/type/priority/assignee/labels for a triage issue. */
  triageSuggest: memberProcedure.input(zod.object({ issueId: id })).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(input.issueId, "write");
    const [i] = await ctx.db.select({ title: issue.title, description: issue.description, projectId: issue.projectId }).from(issue).where(eq(issue.id, input.issueId));
    if (!i) throw new TRPCError({ code: "NOT_FOUND" });
    const { people, labels } = await teamContext(ctx.db, i.projectId);
    const S = z.object({
      type: z.enum(TYPES),
      priority: z.enum(PRIORITIES),
      assigneeId: z.string().nullable(),
      labelNames: z.array(z.string()),
      reason: z.string().describe("One short sentence"),
    });
    const s = await structured(S, `Suggest how to triage this incoming issue. Team: ${JSON.stringify(people)}. Labels: ${JSON.stringify(labels.map((l) => l.name))}.`, `${i.title}\n\n${i.description}`);
    return {
      ...s,
      assigneeId: people.some((p) => p.id === s.assigneeId) ? s.assigneeId : null,
      labelIds: labels.filter((l) => s.labelNames.some((n) => n.toLowerCase() === l.name.toLowerCase())).map((l) => l.id),
    };
  }),

  /** Release notes from the release's finished issues. Falls back to a plain changelog without AI. */
  releaseNotes: memberProcedure.input(zod.object({ releaseId: id })).mutation(async ({ ctx, input }) => {
    const [r] = await ctx.db.select().from(release).where(eq(release.id, input.releaseId));
    if (!r) throw new TRPCError({ code: "NOT_FOUND" });
    await ctx.requireProject(r.projectId, "write");
    const items = await releaseIssues(ctx.db, r.id);
    if (!aiEnabled) return draftNotes(r.name, items);
    const done = items.filter((i) => i.statusCategory === "done");
    if (!done.length) return draftNotes(r.name, items);
    return prose(
      `Write user-facing release notes in Markdown for release "${r.name}". Group under "## New", "## Improved" and "## Fixed" (omit empty groups). One line per change in plain language a customer understands; drop internal-only items. Keep the issue key in parentheses.`,
      done.map((i) => `${i.key} [${i.type}] ${i.title}`).join("\n"),
      "medium",
    );
  }),

  /** Possible duplicates while typing a new title (no AI: Postgres full-text ranking). */
  similar: authedProcedure
    .input(zod.object({ projectId: id.optional(), text: zod.string().max(500), excludeId: id.optional() }))
    .query(async ({ ctx, input }) => {
      if (input.projectId) await ctx.requireProject(input.projectId, "read");
      const q = similarityQuery(input.text);
      const words = q ? q.split(" | ") : [];
      if (words.length < 2) return [];
      const tsq = sql`to_tsquery('english', ${q})`;
      // Overlap = how many of the significant words the issue contains; easier to reason about than ts_rank for OR queries.
      const overlap = sql<number>`(${sql.join(
        words.map((w) => sql`(${issue.search} @@ to_tsquery('english', ${w}))::int`),
        sql` + `,
      )})`;
      const need = Math.max(2, Math.ceil(words.length / 2));
      return ctx.db
        .select({
          id: issue.id,
          key: sql<string>`${project.key} || '-' || ${issue.number}`,
          title: issue.title,
          statusName: workflowStatus.name,
          score: overlap,
        })
        .from(issue)
        .innerJoin(project, eq(project.id, issue.projectId))
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .where(
          and(
            isNull(issue.deletedAt),
            sql`${issue.search} @@ ${tsq}`,
            sql`${overlap} >= ${need}`,
            input.projectId ? eq(issue.projectId, input.projectId) : undefined,
            input.excludeId ? ne(issue.id, input.excludeId) : undefined,
            gte(issue.createdAt, new Date(Date.now() - 365 * 86_400_000)),
            scope(await ctx.access()),
          ),
        )
        .orderBy(desc(overlap), desc(sql`ts_rank(${issue.search}, ${tsq})`))
        .limit(5);
    }),
});

