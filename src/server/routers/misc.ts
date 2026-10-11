import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { commentCreate, commentEdit, ROLES } from "@/lib/validators";
import { activity, comment, issue, notification, project, user } from "../db/schema";
import { BOT_ID } from "../services/bot";
import { addComment, write } from "../services/issues";
import { adminProcedure, authedProcedure, memberProcedure, router } from "../trpc";

export const commentRouter = router({
  list: authedProcedure.input(z.object({ issueId: z.string().uuid() })).query(({ ctx, input }) =>
    ctx.db
      .select({
        id: comment.id,
        parentId: comment.parentId,
        body: comment.body,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
        authorId: comment.authorId,
        authorName: user.name,
        authorImage: user.image,
      })
      .from(comment)
      .innerJoin(user, eq(user.id, comment.authorId))
      .where(and(eq(comment.issueId, input.issueId), isNull(comment.deletedAt)))
      .orderBy(asc(comment.createdAt)),
  ),

  create: memberProcedure.input(commentCreate).mutation(({ ctx, input }) =>
    write(ctx.db, (tx) => addComment(tx, ctx.user.id, input.issueId, input.body, { parentId: input.parentId })),
  ),

  edit: memberProcedure.input(commentEdit).mutation(async ({ ctx, input }) => {
    const [c] = await ctx.db
      .update(comment)
      .set({ body: input.body, editedAt: new Date() })
      .where(and(eq(comment.id, input.id), eq(comment.authorId, ctx.user.id), isNull(comment.deletedAt)))
      .returning();
    if (!c) throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own comments." });
    return c;
  }),

  delete: memberProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const own = ctx.user.role === "admin" ? undefined : eq(comment.authorId, ctx.user.id);
    const [c] = await ctx.db.update(comment).set({ deletedAt: new Date() }).where(and(eq(comment.id, input.id), own)).returning();
    if (!c) throw new TRPCError({ code: "FORBIDDEN" });
  }),
});

export const notificationRouter = router({
  list: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: notification.id,
        reason: notification.reason,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        verb: activity.verb,
        diff: activity.diff,
        actorName: user.name,
        issueKey: sql<string | null>`${project.key} || '-' || ${issue.number}`,
        issueTitle: issue.title,
      })
      .from(notification)
      .innerJoin(activity, eq(activity.id, notification.activityId))
      .innerJoin(user, eq(user.id, activity.actorId))
      .innerJoin(project, eq(project.id, activity.projectId))
      .leftJoin(issue, eq(issue.id, activity.issueId))
      .where(eq(notification.userId, ctx.user.id))
      .orderBy(desc(notification.createdAt))
      .limit(100),
  ),

  unreadCount: authedProcedure.query(async ({ ctx }) => {
    const [{ n }] = await ctx.db
      .select({ n: count() })
      .from(notification)
      .where(and(eq(notification.userId, ctx.user.id), isNull(notification.readAt)));
    return n;
  }),

  markRead: authedProcedure.input(z.object({ ids: z.array(z.string().uuid()).max(200).optional() })).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.userId, ctx.user.id), isNull(notification.readAt), input.ids ? inArray(notification.id, input.ids) : undefined));
  }),
});

export const userRouter = router({
  me: authedProcedure.query(({ ctx }) => ctx.user),

  list: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image, role: user.role })
      .from(user)
      .where(sql`${user.id} <> ${BOT_ID}`)
      .orderBy(asc(user.name)),
  ),

  setRole: adminProcedure.input(z.object({ userId: z.string(), role: z.enum(ROLES) })).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      if (input.role !== "admin") {
        const [{ n }] = await tx.select({ n: count() }).from(user).where(and(eq(user.role, "admin"), sql`${user.id} <> ${input.userId}`));
        if (!n) throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace needs at least one admin." });
      }
      await tx.update(user).set({ role: input.role }).where(eq(user.id, input.userId));
    }),
  ),
});
