import { eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { decrypt } from "@/lib/crypto";
import { db } from "../db";
import { activity, issue, notification, project, projectChannel, user, userSettings, workflowStatus } from "../db/schema";
import { postDiscord } from "../integrations/discord";
import { pushTo } from "../integrations/push";
import { publish } from "../integrations/realtime";
import { postSlack } from "../integrations/slack";
import { deliverWebhooks } from "../integrations/webhooks";
import { sendMail } from "../email";
import { getConfig } from "../integrations/config";
import { reportError } from "../observability";
import { runAutomations } from "./automation";

const inflight = new Set<Promise<unknown>>();

/** Tests (and scripts) await this to make side effects deterministic. */
export async function drainEvents() {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

/** Schedule post-commit work. In a request, `after()` keeps the function alive past the response. */
export function dispatchActivities(ids: string[]) {
  const p = (async () => {
    for (const id of ids) await dispatchOne(id);
  })().catch((e) => console.error("dispatch failed:", e));
  inflight.add(p);
  p.finally(() => inflight.delete(p));
  try {
    after(p);
  } catch {
    // Outside a request scope (tests/cron/scripts): the promise simply runs.
  }
}

const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    void reportError(e, { step: name });
  }
}

const REASON_TEXT = { assigned: "assigned you", mentioned: "mentioned you on", watching: "updated" } as const;

async function dispatchOne(activityId: string) {
  const [a] = await db
    .select({
      act: activity,
      actorName: user.name,
      projectKey: project.key,
      number: issue.number,
      title: issue.title,
      statusName: workflowStatus.name,
    })
    .from(activity)
    .innerJoin(user, eq(user.id, activity.actorId))
    .innerJoin(project, eq(project.id, activity.projectId))
    .leftJoin(issue, eq(issue.id, activity.issueId))
    .leftJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
    .where(eq(activity.id, activityId));
  if (!a) return;
  const { act } = a;
  if (act.source === "import") return publish([`project-${act.projectId}`], "changed", { issueId: act.issueId, verb: act.verb }).catch(() => {});
  const key = a.number ? `${a.projectKey}-${a.number}` : a.projectKey;
  const url = `${appUrl()}/i/${key}`;
  const recipients = await db
    .select({ userId: notification.userId, reason: notification.reason, email: user.email, pref: sql<string | null>`${userSettings.email}` })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.userId))
    .leftJoin(userSettings, eq(userSettings.userId, notification.userId))
    .where(eq(notification.activityId, act.id));

  await step("realtime", () =>
    publish([`project-${act.projectId}`, ...recipients.map((r) => `user-${r.userId}`)], "changed", { issueId: act.issueId, verb: act.verb }),
  );

  const summary =
    act.verb === "commented"
      ? `${a.actorName} commented on ${key}: ${String((act.diff?.comment?.to as string) ?? "").replace(/@\[([^\]]+)\]\([^)]+\)/g, "@$1")}`
      : act.diff?.statusId
        ? `${a.actorName} moved ${key} to ${a.statusName}`
        : `${a.actorName} ${act.verb} ${key}`;

  const inboundDomain = (await getConfig("email"))?.inboundDomain;
  await step("email", () =>
    Promise.all(
      recipients
        .filter((r) => (r.pref ?? "instant") === "instant")
        .map((r) =>
          sendMail({
            to: r.email,
            subject: `[${key}] ${a.title ?? ""}`,
            // Replies land in the project's inbound address and become comments.
            replyTo: inboundDomain ? `${a.projectKey.toLowerCase()}@${inboundDomain}` : undefined,
            text: `${a.actorName} ${REASON_TEXT[r.reason as keyof typeof REASON_TEXT] ?? "updated"} ${key}.\n\n${summary}\n\nOpen: ${url}\n\nChange how you get notified: ${appUrl()}/settings/profile`,
          }),
        ),
    ),
  );

  await step("push", () => pushTo([...new Set(recipients.map((r) => r.userId))], { title: `${key} · ${a.title ?? ""}`, body: summary, url: `/i/${key}` }));

  const channelEvent = act.verb === "created" ? "created" : act.verb === "commented" ? "commented" : act.diff?.statusId ? "statusChanged" : null;
  if (channelEvent && act.issueId) {
    await step("channels", async () => {
      const channels = (await db.select().from(projectChannel).where(eq(projectChannel.projectId, act.projectId))).filter((c) => c.events.includes(channelEvent));
      const text = `${summary}${channelEvent === "created" ? ` — ${a.title}` : ""}\n${url}`;
      await Promise.all(channels.map((c) => (c.kind === "slack" ? postSlack(c.target, text) : postDiscord(decrypt(c.target), text))));
    });
  }

  if (act.issueId)
    await step("webhooks", () =>
      deliverWebhooks(`issue.${act.verb}`, { key, issueId: act.issueId, projectKey: a.projectKey, title: a.title, actor: a.actorName, diff: act.diff, url }),
    );

  if (act.issueId && act.source !== "automation")
    await step("automations", () => runAutomations({ projectId: act.projectId, issueId: act.issueId!, verb: act.verb, diff: act.diff ?? null, key }));
}
