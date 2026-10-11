import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { commentCreate, commentEdit, ROLES } from "@/lib/validators";
import { activity, apiToken, comment, invitation, issue, notification, project, session, user } from "../db/schema";
import { scope } from "../access";
import { sendMail } from "../email";
import { emailTaken } from "../services/invites";
import { BOT_ID } from "../services/bot";
import { addComment, write } from "../services/issues";
import { adminProcedure, authedProcedure, memberProcedure, router } from "../trpc";

export const commentRouter = router({
  list: authedProcedure.input(z.object({ issueId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await ctx.requireIssue(input.issueId, "read");
    return ctx.db
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
      .orderBy(asc(comment.createdAt));
  }),

  create: memberProcedure.input(commentCreate).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(input.issueId, "write");
    return write(ctx.db, (tx) => addComment(tx, ctx.user.id, input.issueId, input.body, { parentId: input.parentId }));
  }),

  edit: memberProcedure.input(commentEdit).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(await issueOfComment(ctx.db, input.id), "write");
    const [c] = await ctx.db
      .update(comment)
      .set({ body: input.body, editedAt: new Date() })
      .where(and(eq(comment.id, input.id), eq(comment.authorId, ctx.user.id), isNull(comment.deletedAt)))
      .returning();
    if (!c) throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own comments." });
    return c;
  }),

  delete: memberProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.requireIssue(await issueOfComment(ctx.db, input.id), "write");
    const own = ctx.user.role === "admin" ? undefined : eq(comment.authorId, ctx.user.id);
    const [c] = await ctx.db.update(comment).set({ deletedAt: new Date() }).where(and(eq(comment.id, input.id), own)).returning();
    if (!c) throw new TRPCError({ code: "FORBIDDEN" });
  }),
});

export const notificationRouter = router({
  list: authedProcedure.query(async ({ ctx }) =>
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
      .where(and(eq(notification.userId, ctx.user.id), scope(await ctx.access(), activity.projectId)))
      .orderBy(desc(notification.createdAt))
      .limit(100),
  ),

  unreadCount: authedProcedure.query(async ({ ctx }) => {
    const [{ n }] = await ctx.db
      .select({ n: count() })
      .from(notification)
      .innerJoin(activity, eq(activity.id, notification.activityId))
      .where(and(eq(notification.userId, ctx.user.id), isNull(notification.readAt), scope(await ctx.access(), activity.projectId)));
    return n;
  }),

  markRead: authedProcedure.input(z.object({ ids: z.array(z.string().uuid()).max(200).optional() })).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.userId, ctx.user.id), isNull(notification.readAt), input.ids ? inArray(notification.id, input.ids) : undefined));
  }),
});

async function issueOfComment(db: typeof import("../db").db, commentId: string) {
  const [c] = await db.select({ issueId: comment.issueId }).from(comment).where(eq(comment.id, commentId));
  if (!c) throw new TRPCError({ code: "NOT_FOUND" });
  return c.issueId;
}

export const userRouter = router({
  me: authedProcedure.query(({ ctx }) => ctx.user),

  /** Active people by default (pickers); the Team page asks for deactivated ones too. */
  list: authedProcedure.input(z.object({ includeDeactivated: z.boolean().default(false) }).optional()).query(({ ctx, input }) =>
    ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        deactivatedAt: user.deactivatedAt,
        twoFactorEnabled: user.twoFactorEnabled,
      })
      .from(user)
      .where(and(sql`${user.id} <> ${BOT_ID}`, input?.includeDeactivated ? undefined : isNull(user.deactivatedAt)))
      .orderBy(asc(user.name)),
  ),

  setRole: adminProcedure.input(z.object({ userId: z.string(), role: z.enum(ROLES) })).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      if (input.role !== "admin") await assertAnotherAdmin(tx, input.userId);
      await tx.update(user).set({ role: input.role }).where(eq(user.id, input.userId));
    }),
  ),

  /** Offboard someone: sign them out everywhere, stop their API tokens, optionally free up their open issues. */
  deactivate: adminProcedure.input(z.object({ userId: z.string(), unassign: z.boolean().default(true) })).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You can't deactivate yourself." });
      if (input.userId === BOT_ID) throw new TRPCError({ code: "BAD_REQUEST" });
      await assertAnotherAdmin(tx, input.userId);
      const [u] = await tx.update(user).set({ deactivatedAt: new Date() }).where(and(eq(user.id, input.userId), isNull(user.deactivatedAt))).returning({ id: user.id });
      if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "No active user with that id." });
      await tx.delete(session).where(eq(session.userId, input.userId));
      await tx.update(apiToken).set({ revokedAt: new Date() }).where(and(eq(apiToken.userId, input.userId), isNull(apiToken.revokedAt)));
      let unassigned = 0;
      if (input.unassign) {
        const rows = await tx
          .update(issue)
          .set({ assigneeId: null, updatedAt: new Date() })
          .where(and(eq(issue.assigneeId, input.userId), isNull(issue.resolvedAt), isNull(issue.deletedAt)))
          .returning({ id: issue.id });
        unassigned = rows.length;
      }
      return { unassigned };
    }),
  ),

  reactivate: adminProcedure.input(z.object({ userId: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.update(user).set({ deactivatedAt: null }).where(eq(user.id, input.userId));
  }),
});

/** Keep at least one active admin, so the workspace can always be managed. */
async function assertAnotherAdmin(tx: Pick<typeof import("../db").db, "select">, exceptUserId: string) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(user)
    .where(and(eq(user.role, "admin"), isNull(user.deactivatedAt), sql`${user.id} <> ${exceptUserId}`));
  if (!n) throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace needs at least one admin." });
}

export const inviteRouter = router({
  list: adminProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt, invitedBy: user.name })
      .from(invitation)
      .leftJoin(user, eq(user.id, invitation.invitedBy))
      .where(and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
      .orderBy(desc(invitation.createdAt)),
  ),

  /** Invite by email; sends a sign-up link. Re-inviting the same address refreshes the invite. */
  create: adminProcedure
    .input(z.object({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(ROLES).default("member") }))
    .mutation(async ({ ctx, input }) => {
      if (await emailTaken(ctx.db, input.email)) throw new TRPCError({ code: "CONFLICT", message: "That person already has an account." });
      await ctx.db
        .update(invitation)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitation.email, input.email), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)));
      const [inv] = await ctx.db
        .insert(invitation)
        .values({ email: input.email, role: input.role, invitedBy: ctx.user.id, expiresAt: new Date(Date.now() + 14 * 86_400_000) })
        .returning();
      const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const link = `${base}/sign-in?mode=signup&email=${encodeURIComponent(input.email)}`;
      let emailed = true;
      await sendMail({
        to: input.email,
        subject: `${ctx.user.name} invited you to Khira`,
        text: `${ctx.user.name} invited you to their team's Khira workspace as ${input.role === "guest" ? "a guest (read-only)" : `a${input.role === "admin" ? "n" : ""} ${input.role}`}.\n\nCreate your account here (the invite lasts 14 days):\n${link}`,
      }).catch(() => (emailed = false));
      return { id: inv.id, link, emailed };
    }),

  revoke: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db.update(invitation).set({ revokedAt: new Date() }).where(eq(invitation.id, input.id));
  }),
});
