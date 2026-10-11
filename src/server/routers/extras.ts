import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { issueKey } from "@/lib/validators";
import { randomToken } from "@/lib/crypto";
import {
  attachment,
  comment,
  commentReaction,
  customField,
  githubLink,
  issue,
  issueCustomValue,
  issueLink,
  project,
  pushSubscription,
  userSettings,
  watcher,
  workflowStatus,
} from "../db/schema";
import { isPushEndpoint } from "../integrations/push";
import { logActivity, write } from "../services/issues";
import { downloadUrl, MAX_UPLOAD_BYTES, mimeAllowed, storedSize, uploadUrl } from "../storage";
import { adminProcedure, authedProcedure, memberProcedure, router } from "../trpc";

const id = z.string().uuid();
const other = alias(issue, "other");
const otherProject = alias(project, "other_project");
const otherStatus = alias(workflowStatus, "other_status");

async function issueOr404(db: typeof import("../db").db, issueId: string) {
  const [i] = await db.select({ id: issue.id, projectId: issue.projectId }).from(issue).where(and(eq(issue.id, issueId), isNull(issue.deletedAt)));
  if (!i) throw new TRPCError({ code: "NOT_FOUND" });
  return i;
}

export const issueExtrasRouter = router({
  // ---- watching ----
  watching: authedProcedure.input(z.object({ issueId: id })).query(async ({ ctx, input }) => {
    const rows = await ctx.db.select({ userId: watcher.userId }).from(watcher).where(eq(watcher.issueId, input.issueId));
    return { count: rows.length, me: rows.some((r) => r.userId === ctx.user.id) };
  }),
  setWatching: authedProcedure.input(z.object({ issueId: id, watching: z.boolean() })).mutation(async ({ ctx, input }) => {
    await issueOr404(ctx.db, input.issueId);
    if (input.watching) await ctx.db.insert(watcher).values({ issueId: input.issueId, userId: ctx.user.id }).onConflictDoNothing();
    else await ctx.db.delete(watcher).where(and(eq(watcher.issueId, input.issueId), eq(watcher.userId, ctx.user.id)));
  }),

  // ---- links ----
  links: authedProcedure.input(z.object({ issueId: id })).query(async ({ ctx, input }) => {
    const sel = (dir: "out" | "in") =>
      ctx.db
        .select({
          id: issueLink.id,
          type: issueLink.type,
          otherId: other.id,
          key: sql<string>`${otherProject.key} || '-' || ${other.number}`,
          title: other.title,
          statusName: otherStatus.name,
          statusCategory: otherStatus.category,
        })
        .from(issueLink)
        .innerJoin(other, eq(other.id, dir === "out" ? issueLink.toId : issueLink.fromId))
        .innerJoin(otherProject, eq(otherProject.id, other.projectId))
        .innerJoin(otherStatus, eq(otherStatus.id, other.statusId))
        .where(and(eq(dir === "out" ? issueLink.fromId : issueLink.toId, input.issueId), isNull(other.deletedAt)));
    const [out, inc] = await Promise.all([sel("out"), sel("in")]);
    const INVERSE = { blocks: "is blocked by", relates: "relates to", duplicates: "is duplicated by", clones: "is cloned by" } as const;
    const FORWARD = { blocks: "blocks", relates: "relates to", duplicates: "duplicates", clones: "clones" } as const;
    return [...out.map((l) => ({ ...l, label: FORWARD[l.type] })), ...inc.map((l) => ({ ...l, label: INVERSE[l.type] }))];
  }),
  addLink: memberProcedure
    .input(z.object({ issueId: id, type: z.enum(["blocks", "blocked_by", "relates", "duplicates", "clones"]), target: issueKey }))
    .mutation(({ ctx, input }) =>
      write(ctx.db, async (tx) => {
        const src = await issueOr404(ctx.db, input.issueId);
        const [t] = await tx
          .select({ id: issue.id })
          .from(issue)
          .innerJoin(project, eq(project.id, issue.projectId))
          .where(and(eq(project.key, input.target.key), eq(issue.number, input.target.number), isNull(issue.deletedAt)));
        if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "No issue with that key." });
        if (t.id === src.id) throw new TRPCError({ code: "BAD_REQUEST", message: "An issue can't link to itself." });
        const [fromId, toId, type] = input.type === "blocked_by" ? [t.id, src.id, "blocks" as const] : [src.id, t.id, input.type];
        await tx.insert(issueLink).values({ fromId, toId, type }).onConflictDoNothing();
        await logActivity(tx, { actorId: ctx.user.id, projectId: src.projectId, issueId: src.id, verb: "linked", diff: { link: { from: null, to: `${input.type} ${input.target.key}-${input.target.number}` } } });
      }),
    ),
  removeLink: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(issueLink).where(eq(issueLink.id, input.id));
  }),

  github: authedProcedure.input(z.object({ issueId: id })).query(({ ctx, input }) =>
    ctx.db.select().from(githubLink).where(eq(githubLink.issueId, input.issueId)).orderBy(asc(githubLink.kind), asc(githubLink.updatedAt)),
  ),

  // ---- reactions ----
  react: authedProcedure.input(z.object({ commentId: id, emoji: z.enum(["👍", "🎉", "❤️", "👀", "🚀", "😕"]) })).mutation(async ({ ctx, input }) => {
    const where = and(eq(commentReaction.commentId, input.commentId), eq(commentReaction.userId, ctx.user.id), eq(commentReaction.emoji, input.emoji));
    const [existing] = await ctx.db.select().from(commentReaction).where(where);
    if (existing) await ctx.db.delete(commentReaction).where(where);
    else {
      const [c] = await ctx.db.select({ id: comment.id }).from(comment).where(and(eq(comment.id, input.commentId), isNull(comment.deletedAt)));
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.insert(commentReaction).values({ ...input, userId: ctx.user.id });
    }
  }),
  reactions: authedProcedure.input(z.object({ issueId: id })).query(async ({ ctx, input }) =>
    ctx.db
      .select({ commentId: commentReaction.commentId, emoji: commentReaction.emoji, userId: commentReaction.userId })
      .from(commentReaction)
      .innerJoin(comment, eq(comment.id, commentReaction.commentId))
      .where(eq(comment.issueId, input.issueId)),
  ),

  // ---- custom fields ----
  fields: authedProcedure.input(z.object({ projectId: id })).query(({ ctx, input }) =>
    ctx.db.select().from(customField).where(eq(customField.projectId, input.projectId)).orderBy(asc(customField.position), asc(customField.name)),
  ),
  saveField: adminProcedure
    .input(
      z.object({
        projectId: id,
        id: id.optional(),
        name: z.string().trim().min(1).max(40),
        type: z.enum(["text", "number", "select", "date"]),
        options: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id: fieldId, ...f } }) => {
      if (f.type === "select" && !f.options?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "A select field needs at least one option." });
      if (fieldId) {
        const [row] = await ctx.db.update(customField).set(f).where(and(eq(customField.id, fieldId), eq(customField.projectId, f.projectId))).returning();
        return row;
      }
      const [row] = await ctx.db.insert(customField).values(f).returning();
      return row;
    }),
  deleteField: adminProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(customField).where(eq(customField.id, input.id));
  }),
  values: authedProcedure.input(z.object({ issueId: id })).query(({ ctx, input }) =>
    ctx.db.select().from(issueCustomValue).where(eq(issueCustomValue.issueId, input.issueId)),
  ),
  setValue: memberProcedure
    .input(z.object({ issueId: id, fieldId: id, value: z.union([z.string().max(2000), z.number()]).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const i = await issueOr404(ctx.db, input.issueId);
      const [f] = await ctx.db.select().from(customField).where(and(eq(customField.id, input.fieldId), eq(customField.projectId, i.projectId)));
      if (!f) throw new TRPCError({ code: "BAD_REQUEST", message: "That field isn't part of this project." });
      const key = and(eq(issueCustomValue.issueId, i.id), eq(issueCustomValue.fieldId, f.id));
      if (input.value === null || input.value === "") return void (await ctx.db.delete(issueCustomValue).where(key));
      const v = input.value;
      const ok =
        (f.type === "number" && typeof v === "number" && Number.isFinite(v)) ||
        (f.type === "text" && typeof v === "string") ||
        (f.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ||
        (f.type === "select" && typeof v === "string" && !!f.options?.includes(v));
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid value for ${f.name}.` });
      await ctx.db
        .insert(issueCustomValue)
        .values({ issueId: i.id, fieldId: f.id, value: v })
        .onConflictDoUpdate({ target: [issueCustomValue.issueId, issueCustomValue.fieldId], set: { value: v } });
    }),

  // ---- attachments ----
  attachments: authedProcedure.input(z.object({ issueId: id })).query(({ ctx, input }) =>
    ctx.db
      .select()
      .from(attachment)
      .where(and(eq(attachment.issueId, input.issueId), eq(attachment.uploaded, true)))
      .orderBy(asc(attachment.createdAt)),
  ),
  createUpload: memberProcedure
    .input(z.object({ issueId: id, name: z.string().trim().min(1).max(200), mime: z.string().max(120), size: z.number().int().min(1).max(MAX_UPLOAD_BYTES) }))
    .mutation(async ({ ctx, input }) => {
      await issueOr404(ctx.db, input.issueId);
      if (!mimeAllowed(input.mime)) throw new TRPCError({ code: "BAD_REQUEST", message: "That file type isn't allowed. Use images, PDFs, text, office docs, zip or video." });
      const storageKey = `${input.issueId}/${randomToken(12)}-${input.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
      const [a] = await ctx.db.insert(attachment).values({ ...input, storageKey, uploaderId: ctx.user.id }).returning();
      return { id: a.id, ...(await uploadUrl(storageKey, input.mime)) };
    }),
  confirmUpload: memberProcedure.input(z.object({ id })).mutation(({ ctx, input }) =>
    write(ctx.db, async (tx) => {
      const [a] = await tx.select().from(attachment).where(and(eq(attachment.id, input.id), eq(attachment.uploaderId, ctx.user.id)));
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      const size = await storedSize(a.storageKey);
      if (size === null) throw new TRPCError({ code: "BAD_REQUEST", message: "The upload didn't finish. Try again." });
      if (size > MAX_UPLOAD_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "File is larger than 25 MB." });
      await tx.update(attachment).set({ uploaded: true, size }).where(eq(attachment.id, a.id));
      const i = await issueOr404(ctx.db, a.issueId);
      await logActivity(tx, { actorId: ctx.user.id, projectId: i.projectId, issueId: i.id, verb: "attached", diff: { attachment: { from: null, to: a.name } } });
    }),
  ),
  attachmentUrl: authedProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const [a] = await ctx.db.select().from(attachment).where(and(eq(attachment.id, input.id), eq(attachment.uploaded, true)));
    if (!a) throw new TRPCError({ code: "NOT_FOUND" });
    return downloadUrl(a.storageKey, a.name, a.mime);
  }),
  deleteAttachment: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const own = ctx.user.role === "admin" ? undefined : eq(attachment.uploaderId, ctx.user.id);
    // ponytail: the stored object is left behind (cheap); add a cleanup cron if storage cost matters.
    const [a] = await ctx.db.delete(attachment).where(and(eq(attachment.id, input.id), own)).returning();
    if (!a) throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own attachments." });
  }),
});

export const settingsRouter = router({
  get: authedProcedure.query(async ({ ctx }) => {
    const [s] = await ctx.db.select().from(userSettings).where(eq(userSettings.userId, ctx.user.id));
    return s ?? { userId: ctx.user.id, email: "instant" as const, push: true, slackUserId: null, githubLogin: null, timezone: "UTC" };
  }),
  update: authedProcedure
    .input(
      z.object({
        email: z.enum(["instant", "digest", "off"]).optional(),
        push: z.boolean().optional(),
        slackUserId: z.string().regex(/^[UW][A-Z0-9]{2,20}$/).nullable().optional(),
        githubLogin: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).nullable().optional(),
        timezone: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.timezone) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: input.timezone });
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown time zone." });
        }
      }
      await ctx.db
        .insert(userSettings)
        .values({ userId: ctx.user.id, ...input })
        .onConflictDoUpdate({ target: userSettings.userId, set: input });
    }),
  subscribePush: authedProcedure
    .input(
      z.object({
        endpoint: z.string().url().max(1000).refine(isPushEndpoint, "Unsupported push service."),
        keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Never reassign someone else's subscription: only refresh keys on my own row.
      await ctx.db
        .insert(pushSubscription)
        .values({ userId: ctx.user.id, ...input })
        .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { keys: input.keys }, setWhere: eq(pushSubscription.userId, ctx.user.id) });
    }),
  unsubscribePush: authedProcedure.input(z.object({ endpoint: z.string().max(1000) })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(pushSubscription).where(and(eq(pushSubscription.endpoint, input.endpoint), eq(pushSubscription.userId, ctx.user.id)));
  }),
});

