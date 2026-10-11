import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { encrypt, randomToken, sha256 } from "@/lib/crypto";
import { publicConfig } from "@/lib/public-config";
import { nextRun } from "@/lib/recurrence";
import { apiToken, automationRule, automationRun, issueTemplate, outgoingWebhook, projectChannel, recurringIssue } from "../db/schema";
import { postDiscord } from "../integrations/discord";
import { getConfig, getIntegration, removeIntegration, saveIntegration } from "../integrations/config";
import { postSlack, slackApi } from "../integrations/slack";
import { sendMail } from "../email";
import { assertPublicUrl } from "../integrations/webhooks";
import { createFromTemplate } from "../services/templates";
import { write } from "../services/issues";
import { adminProcedure, authedProcedure, memberProcedure, router } from "../trpc";

const id = z.string().uuid();
const PRIORITY = z.enum(["none", "low", "medium", "high", "urgent"]);

const condition = z.object({
  field: z.enum(["type", "priority", "statusId", "assigneeId", "labelId", "title"]),
  op: z.enum(["is", "isNot", "contains"]),
  value: z.string().max(200).nullable(),
});
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assign"), userId: z.string().nullable() }),
  z.object({ type: z.literal("setPriority"), priority: PRIORITY }),
  z.object({ type: z.literal("setStatus"), statusId: id }),
  z.object({ type: z.literal("addLabel"), labelId: id }),
  z.object({ type: z.literal("comment"), body: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("notifySlack"), text: z.string().min(1).max(1000) }),
]);
const templateFields = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(20_000).optional(),
  type: z.enum(["epic", "story", "task", "bug", "subtask"]).optional(),
  priority: PRIORITY.optional(),
  assigneeId: z.string().nullable().optional(),
  labelIds: z.array(id).max(20).optional(),
  subtasks: z.array(z.string().trim().min(1).max(255)).max(30).optional(),
});
const recurrence = z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(52),
  weekday: z.number().int().min(0).max(6).optional(),
  monthDay: z.number().int().min(1).max(28).optional(),
  hour: z.number().int().min(0).max(23).optional(),
});

export const integrationRouter = router({
  status: authedProcedure.query(async () => {
    const [slack, github, email] = await Promise.all([getConfig("slack"), getConfig("github"), getConfig("email")]);
    return {
      slack: !!slack,
      github: !!github,
      inboundEmail: !!email?.inboundSecret,
      inboundDomain: email?.inboundDomain ?? null,
      ai: !!process.env.ANTHROPIC_API_KEY,
      realtime: !!publicConfig().pusher,
      push: !!publicConfig().vapidPublicKey,
      storage: !!process.env.S3_BUCKET,
      email: !!email?.resendKey || !!process.env.SMTP_URL,
    };
  }),

  /** Everything the Integrations page shows. Never returns a secret except right after generating one. */
  connections: adminProcedure.query(async () => {
    const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const [slack, github, email] = await Promise.all([getIntegration("slack"), getIntegration("github"), getIntegration("email")]);
    return {
      baseUrl: base,
      slack: slack && { source: slack.source, team: slack.meta.team ?? null, standupChannel: slack.config.standupChannel },
      github: github && { source: github.source, lastEventAt: github.meta.lastEventAt ?? null, lastEvent: github.meta.lastEvent ?? null },
      email: email && {
        source: email.source,
        sending: !!email.config.resendKey,
        from: email.config.from,
        inbound: !!email.config.inboundSecret,
        inboundDomain: email.config.inboundDomain,
        lastInboundAt: email.meta.lastInboundAt ?? null,
      },
      urls: {
        github: `${base}/api/webhooks/github`,
        slackCommands: `${base}/api/slack/commands`,
        slackInteractivity: `${base}/api/slack/interactivity`,
        slackEvents: `${base}/api/slack/events`,
        email: `${base}/api/webhooks/email`,
      },
    };
  }),

  connectSlack: adminProcedure
    .input(
      z.object({
        botToken: z.string().trim().max(200).optional(),
        signingSecret: z.string().trim().max(200).optional(),
        standupChannel: z.string().trim().regex(/^([CGD][A-Z0-9]{6,})?$/, "Use the channel ID (starts with C)").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = (await getIntegration("slack"))?.source === "app" ? await getConfig("slack") : null;
      const botToken = input.botToken || current?.botToken;
      const signingSecret = input.signingSecret || current?.signingSecret;
      if (!botToken?.startsWith("xoxb-")) throw new TRPCError({ code: "BAD_REQUEST", message: "Paste the Bot User OAuth Token (starts with xoxb-)." });
      if (!signingSecret || !/^[a-f0-9]{20,}$/i.test(signingSecret)) throw new TRPCError({ code: "BAD_REQUEST", message: "Paste the Signing Secret from Basic Information." });
      // Prove the token works before saving it.
      const auth = await slackApi<{ team?: string }>("auth.test", {}, botToken).catch((e) => {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Slack rejected the token: ${(e as Error).message.replace("Slack auth.test: ", "")}` });
      });
      await saveIntegration("slack", { botToken, signingSecret }, { team: auth.team ?? null, standupChannel: input.standupChannel || null }, ctx.user.id);
      return { team: auth.team ?? null };
    }),

  /** Generates a fresh webhook secret; shown once so it can be pasted into GitHub. */
  connectGithub: adminProcedure.mutation(async ({ ctx }) => {
    const secret = randomToken(24);
    await saveIntegration("github", { webhookSecret: secret }, {}, ctx.user.id);
    return { secret };
  }),

  connectEmail: adminProcedure
    .input(
      z.object({
        resendKey: z.string().trim().max(200).optional(),
        from: z.string().trim().max(200).optional(),
        inboundDomain: z.string().trim().toLowerCase().regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, "Enter a domain like in.yourteam.dev").optional().or(z.literal("")),
        enableInbound: z.boolean().default(false),
        rotateInbound: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cur = (await getIntegration("email"))?.source === "app" ? await getConfig("email") : null;
      const resendKey = input.resendKey || cur?.resendKey || null;
      if (resendKey && !resendKey.startsWith("re_")) throw new TRPCError({ code: "BAD_REQUEST", message: "Resend API keys start with re_." });
      const from = input.from || cur?.from || null;
      if (resendKey && !from) throw new TRPCError({ code: "BAD_REQUEST", message: "Add a From address on your verified Resend domain, e.g. Khira <noreply@yourteam.dev>." });
      const inboundDomain = input.inboundDomain || cur?.inboundDomain || null;
      const fresh = input.rotateInbound || (input.enableInbound && !cur?.inboundSecret);
      const inboundSecret = fresh ? randomToken(18) : (cur?.inboundSecret ?? null);
      if (input.enableInbound && !inboundDomain) throw new TRPCError({ code: "BAD_REQUEST", message: "Email-to-issue needs the domain your inbound mail arrives on." });
      await saveIntegration("email", { resendKey, inboundSecret }, { from, inboundDomain }, ctx.user.id);
      // The secret is only ever shown right after it's generated.
      return { inboundSecret: fresh ? inboundSecret : null };
    }),

  sendTestEmail: adminProcedure.mutation(async ({ ctx }) => {
    await sendMail({ to: ctx.user.email, subject: "Khira test email", text: "Email from Khira works. You'll get notifications like this." }).catch((e) => {
      throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
    });
  }),

  disconnect: adminProcedure.input(z.object({ kind: z.enum(["slack", "github", "email"]) })).mutation(async ({ input }) => {
    await removeIntegration(input.kind);
  }),

  channels: adminProcedure.input(z.object({ projectId: id })).query(async ({ ctx, input }) =>
    (await ctx.db.select().from(projectChannel).where(eq(projectChannel.projectId, input.projectId))).map((c) => ({
      ...c,
      // Never send the Discord webhook URL (a secret) back to the browser.
      target: c.kind === "discord" ? "Discord webhook" : c.target,
    })),
  ),
  addChannel: adminProcedure
    .input(
      z.object({
        projectId: id,
        kind: z.enum(["slack", "discord"]),
        target: z.string().trim().min(1).max(500),
        events: z.array(z.enum(["created", "statusChanged", "commented", "released"])).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.kind === "slack") {
        if (!/^[CGD][A-Z0-9]{6,}$/.test(input.target)) throw new TRPCError({ code: "BAD_REQUEST", message: "Use the Slack channel ID (starts with C), from the channel's details." });
        await postSlack(input.target, "Khira is connected to this channel.").catch((e) => {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Slack said: ${(e as Error).message}. Invite the Khira app to the channel first.` });
        });
      } else {
        await postDiscord(input.target, "Khira is connected to this channel.").catch((e) => {
          throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
        });
      }
      const [c] = await ctx.db
        .insert(projectChannel)
        .values({ ...input, target: input.kind === "discord" ? encrypt(input.target) : input.target })
        .returning({ id: projectChannel.id });
      return c;
    }),
  removeChannel: adminProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(projectChannel).where(eq(projectChannel.id, input.id));
  }),

  // ---- outgoing webhooks (workspace-wide) ----
  webhooks: adminProcedure.query(async ({ ctx }) =>
    (await ctx.db.select().from(outgoingWebhook).orderBy(desc(outgoingWebhook.createdAt))).map(({ secret: _s, ...w }) => w),
  ),
  addWebhook: adminProcedure.input(z.object({ url: z.string().url().max(500), events: z.array(z.string().max(40)).min(1).max(20) })).mutation(async ({ ctx, input }) => {
    try {
      assertPublicUrl(input.url);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
    }
    const secret = randomToken(24);
    await ctx.db.insert(outgoingWebhook).values({ ...input, secret: encrypt(secret), createdBy: ctx.user.id });
    return { secret }; // shown once
  }),
  removeWebhook: adminProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(outgoingWebhook).where(eq(outgoingWebhook.id, input.id));
  }),

  // ---- personal API tokens ----
  tokens: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: apiToken.id, name: apiToken.name, prefix: apiToken.prefix, lastUsedAt: apiToken.lastUsedAt, createdAt: apiToken.createdAt })
      .from(apiToken)
      .where(and(eq(apiToken.userId, ctx.user.id), isNull(apiToken.revokedAt)))
      .orderBy(desc(apiToken.createdAt)),
  ),
  createToken: memberProcedure.input(z.object({ name: z.string().trim().min(1).max(60) })).mutation(async ({ ctx, input }) => {
    const token = `khira_${randomToken(30)}`;
    await ctx.db.insert(apiToken).values({ userId: ctx.user.id, name: input.name, hash: sha256(token), prefix: token.slice(0, 12) });
    return { token }; // shown once
  }),
  revokeToken: authedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(apiToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiToken.id, input.id), eq(apiToken.userId, ctx.user.id)));
  }),
});

async function projectOf<T extends { projectId: string }>(rows: T[]) {
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
  return rows[0];
}

export const automationRouter = router({
  rules: authedProcedure.input(z.object({ projectId: id })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    return ctx.db.select().from(automationRule).where(eq(automationRule.projectId, input.projectId)).orderBy(desc(automationRule.createdAt));
  }),
  saveRule: memberProcedure
    .input(
      z.object({
        projectId: id,
        id: id.optional(),
        name: z.string().trim().min(1).max(80),
        trigger: z.enum(["created", "updated", "commented", "statusChanged"]),
        conditions: z.array(condition).max(10),
        actions: z.array(action).min(1).max(10),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input: { id: rid, ...r } }) => {
      await ctx.requireProject(r.projectId, "admin");
      if (rid) {
        const [row] = await ctx.db
          .update(automationRule)
          .set(r)
          .where(and(eq(automationRule.id, rid), eq(automationRule.projectId, r.projectId)))
          .returning();
        return row;
      }
      const [row] = await ctx.db.insert(automationRule).values({ ...r, createdBy: ctx.user.id }).returning();
      return row;
    }),
  deleteRule: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const rule = await projectOf(await ctx.db.select({ projectId: automationRule.projectId }).from(automationRule).where(eq(automationRule.id, input.id)));
    await ctx.requireProject(rule.projectId, "admin");
    await ctx.db.delete(automationRule).where(eq(automationRule.id, input.id));
  }),
  runs: authedProcedure.input(z.object({ ruleId: id })).query(async ({ ctx, input }) => {
    const rule = await projectOf(await ctx.db.select({ projectId: automationRule.projectId }).from(automationRule).where(eq(automationRule.id, input.ruleId)));
    await ctx.requireProject(rule.projectId, "read");
    return ctx.db.select().from(automationRun).where(eq(automationRun.ruleId, input.ruleId)).orderBy(desc(automationRun.createdAt)).limit(20);
  }),

  // ---- templates & recurring issues ----
  templates: authedProcedure.input(z.object({ projectId: id })).query(async ({ ctx, input }) => {
    await ctx.requireProject(input.projectId, "read");
    const ts = await ctx.db.select().from(issueTemplate).where(eq(issueTemplate.projectId, input.projectId)).orderBy(issueTemplate.name);
    const rec = ts.length ? await ctx.db.select().from(recurringIssue) : [];
    return ts.map((t) => ({ ...t, recurring: rec.find((r) => r.templateId === t.id) ?? null }));
  }),
  saveTemplate: memberProcedure
    .input(z.object({ projectId: id, id: id.optional(), name: z.string().trim().min(1).max(80), fields: templateFields }))
    .mutation(async ({ ctx, input }) => {
      await ctx.requireProject(input.projectId, "write");
      if (input.id) {
        const [t] = await ctx.db
          .update(issueTemplate)
          .set({ name: input.name, fields: input.fields })
          .where(and(eq(issueTemplate.id, input.id), eq(issueTemplate.projectId, input.projectId)))
          .returning();
        return t;
      }
      const [t] = await ctx.db.insert(issueTemplate).values({ projectId: input.projectId, name: input.name, fields: input.fields }).returning();
      return t;
    }),
  deleteTemplate: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const t = await projectOf(await ctx.db.select({ projectId: issueTemplate.projectId }).from(issueTemplate).where(eq(issueTemplate.id, input.id)));
    await ctx.requireProject(t.projectId, "write");
    await ctx.db.delete(issueTemplate).where(eq(issueTemplate.id, input.id));
  }),
  useTemplate: memberProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const t = await projectOf(await ctx.db.select().from(issueTemplate).where(eq(issueTemplate.id, input.id)));
    await ctx.requireProject(t.projectId, "write");
    return write(ctx.db, (tx) => createFromTemplate(tx, ctx.user.id, t, "user"));
  }),
  setRecurring: memberProcedure.input(z.object({ templateId: id, rule: recurrence.nullable() })).mutation(async ({ ctx, input }) => {
    const t = await projectOf(await ctx.db.select({ projectId: issueTemplate.projectId }).from(issueTemplate).where(eq(issueTemplate.id, input.templateId)));
    await ctx.requireProject(t.projectId, "write");
    await ctx.db.delete(recurringIssue).where(eq(recurringIssue.templateId, input.templateId));
    if (!input.rule) return null;
    const [r] = await ctx.db
      .insert(recurringIssue)
      .values({ templateId: input.templateId, rule: input.rule, nextRunAt: nextRun(input.rule, new Date()), createdBy: ctx.user.id })
      .returning();
    return r;
  }),
});
