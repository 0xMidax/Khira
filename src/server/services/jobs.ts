import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { aiEnabled, prose } from "../ai";
import type { DB } from "../db";
import { alias } from "drizzle-orm/pg-core";
import { activity, issue, issueLink, issueTemplate, notification, project, recurringIssue, sprint, standup, user, userSettings, workflowStatus } from "../db/schema";
import { nextRun } from "@/lib/recurrence";
import { sendMail } from "../email";
import { getConfig } from "../integrations/config";
import { postSlack } from "../integrations/slack";
import { ensureBot, BOT_ID } from "./bot";
import { logActivity, write } from "./issues";
import { createFromTemplate } from "./templates";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/** A system activity + notifications for `recipients` (dispatch sends email/push/realtime). */
async function nudge(db: DB, a: { projectId: string; issueId?: string | null; verb: string; diff: Record<string, { from: unknown; to: unknown }>; recipients: string[] }) {
  const to = [...new Set(a.recipients.filter((r) => r && r !== BOT_ID))];
  await ensureBot(db);
  await write(db, async (tx) => {
    const act = await logActivity(tx, { actorId: BOT_ID, projectId: a.projectId, issueId: a.issueId ?? null, verb: a.verb, diff: a.diff, source: "system" });
    if (to.length) await tx.insert(notification).values(to.map((userId) => ({ userId, activityId: act.id, reason: "watching" })));
  });
}

async function alreadyNudged(db: DB, issueId: string, verb: string, since: Date) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activity)
    .where(and(eq(activity.issueId, issueId), eq(activity.verb, verb), gte(activity.createdAt, since)));
  return r.n > 0;
}

// ---------- every ~15 minutes ----------

export async function runRecurring(db: DB, now = new Date()) {
  const due = await db
    .select({ r: recurringIssue, t: issueTemplate })
    .from(recurringIssue)
    .innerJoin(issueTemplate, eq(issueTemplate.id, recurringIssue.templateId))
    .where(and(eq(recurringIssue.enabled, true), lte(recurringIssue.nextRunAt, now)));
  let created = 0;
  for (const { r, t } of due) {
    // Claim the slot first (compare-and-set on nextRunAt) so overlapping cron runs can't double-create.
    const next = nextRun(r.rule, now, r.nextRunAt);
    const [claimed] = await db
      .update(recurringIssue)
      .set({ nextRunAt: next })
      .where(and(eq(recurringIssue.id, r.id), eq(recurringIssue.nextRunAt, r.nextRunAt)))
      .returning({ id: recurringIssue.id });
    if (!claimed) continue;
    try {
      await write(db, (tx) => createFromTemplate(tx, r.createdBy, t, "system"));
      created++;
    } catch (e) {
      console.warn(`recurring ${r.id} failed:`, (e as Error).message);
    }
  }
  return { created };
}

/** SLA: first-response and resolve targets per priority (project settings). One nudge per kind per issue. */
export async function checkSla(db: DB, now = new Date()) {
  const projects = (await db.select({ id: project.id, leadId: project.leadId, settings: project.settings }).from(project).where(isNull(project.archivedAt))).filter(
    (p) => p.settings.sla && Object.keys(p.settings.sla).length,
  );
  let breached = 0;
  for (const p of projects) {
    const open = await db
      .select({ id: issue.id, priority: issue.priority, createdAt: issue.createdAt, firstResponseAt: issue.firstResponseAt, assigneeId: issue.assigneeId, number: issue.number, title: issue.title })
      .from(issue)
      .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
      .where(and(eq(issue.projectId, p.id), isNull(issue.deletedAt), ne(workflowStatus.category, "done")));
    for (const i of open) {
      const t = p.settings.sla?.[i.priority as "urgent"];
      if (!t) continue;
      const age = now.getTime() - i.createdAt.getTime();
      const kinds: ["slaResponse" | "slaResolve", boolean][] = [
        ["slaResponse", !!t.responseHours && !i.firstResponseAt && age > t.responseHours * HOUR],
        ["slaResolve", !!t.resolveHours && age > t.resolveHours * HOUR],
      ];
      for (const [verb, hit] of kinds) {
        if (!hit || (await alreadyNudged(db, i.id, verb, new Date(0)))) continue;
        await nudge(db, {
          projectId: p.id,
          issueId: i.id,
          verb,
          diff: { sla: { from: null, to: verb === "slaResponse" ? `No response within ${t.responseHours}h` : `Not resolved within ${t.resolveHours}h` } },
          recipients: [i.assigneeId ?? p.leadId ?? ""],
        });
        breached++;
      }
    }
  }
  return { breached };
}

/** Pure: where the sprint should be vs where it is. "at risk" when >20% of committed scope is behind the guideline. */
export function sprintRisk(s: { startDate: string; endDate: string }, remaining: number, total: number, now = new Date()) {
  const start = new Date(`${s.startDate}T00:00:00Z`).getTime();
  const end = new Date(`${s.endDate}T23:59:59Z`).getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
  const expected = total * (1 - elapsed);
  return { atRisk: total > 0 && elapsed >= 0.3 && remaining - expected > total * 0.2, expected: Math.round(expected), remaining };
}

// ---------- daily ----------

export async function dailyNudges(db: DB, now = new Date()) {
  const projects = await db.select().from(project).where(isNull(project.archivedAt));
  let stale = 0;
  let overdue = 0;
  let risky = 0;
  for (const p of projects) {
    const staleDays = p.settings.staleDays ?? 0;
    if (staleDays > 0) {
      const rows = await db
        .select({ id: issue.id, assigneeId: issue.assigneeId, number: issue.number, statusName: workflowStatus.name })
        .from(issue)
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .where(and(eq(issue.projectId, p.id), isNull(issue.deletedAt), eq(workflowStatus.category, "in_progress"), lte(issue.statusChangedAt, new Date(now.getTime() - staleDays * DAY))));
      for (const r of rows) {
        if (!r.assigneeId || (await alreadyNudged(db, r.id, "stale", new Date(now.getTime() - staleDays * DAY)))) continue;
        await nudge(db, { projectId: p.id, issueId: r.id, verb: "stale", diff: { stale: { from: null, to: `In ${r.statusName} for ${staleDays}+ days` } }, recipients: [r.assigneeId] });
        stale++;
      }
    }
    const late = await db
      .select({ id: issue.id, assigneeId: issue.assigneeId, dueDate: issue.dueDate })
      .from(issue)
      .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
      .where(and(eq(issue.projectId, p.id), isNull(issue.deletedAt), ne(workflowStatus.category, "done"), sql`${issue.dueDate} < ${now.toISOString().slice(0, 10)}`));
    for (const r of late) {
      if (!r.assigneeId || (await alreadyNudged(db, r.id, "overdue", new Date(now.getTime() - 3 * DAY)))) continue; // at most every 3 days
      await nudge(db, { projectId: p.id, issueId: r.id, verb: "overdue", diff: { due: { from: null, to: r.dueDate } }, recipients: [r.assigneeId] });
      overdue++;
    }
    const [active] = await db.select().from(sprint).where(and(eq(sprint.projectId, p.id), eq(sprint.state, "active")));
    if (active?.startDate && active.endDate) {
      const items = await db
        .select({ estimate: issue.estimate, done: sql<boolean>`${workflowStatus.category} = 'done'`, assigneeId: issue.assigneeId })
        .from(issue)
        .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
        .where(and(eq(issue.sprintId, active.id), isNull(issue.deletedAt)));
      const w = (i: { estimate: number | null }) => i.estimate ?? 1;
      const risk = sprintRisk(active as { startDate: string; endDate: string }, items.filter((i) => !i.done).reduce((n, i) => n + w(i), 0), items.reduce((n, i) => n + w(i), 0), now);
      const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(activity)
        .where(and(eq(activity.projectId, p.id), eq(activity.verb, "sprintAtRisk"), gte(activity.createdAt, new Date(now.getTime() - 2 * DAY))));
      if (risk.atRisk && !recent.n) {
        await nudge(db, {
          projectId: p.id,
          verb: "sprintAtRisk",
          diff: { sprint: { from: null, to: `${active.name}: ${risk.remaining} left, guideline says ${risk.expected}` } },
          recipients: [p.leadId ?? "", ...items.map((i) => i.assigneeId ?? "")],
        });
        risky++;
      }
    }
  }
  return { stale, overdue, risky };
}

/** Daily digest for people who chose "digest" email. */
export async function sendDigests(db: DB, now = new Date()) {
  const people = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .innerJoin(userSettings, eq(userSettings.userId, user.id))
    .where(eq(userSettings.email, "digest"));
  let sent = 0;
  for (const u of people) {
    const rows = await db
      .select({ verb: activity.verb, actor: sql<string>`(select name from "user" where id = ${activity.actorId})`, key: sql<string>`${project.key} || '-' || ${issue.number}`, title: issue.title })
      .from(notification)
      .innerJoin(activity, eq(activity.id, notification.activityId))
      .innerJoin(project, eq(project.id, activity.projectId))
      .leftJoin(issue, eq(issue.id, activity.issueId))
      .where(and(eq(notification.userId, u.id), isNull(notification.readAt), gte(notification.createdAt, new Date(now.getTime() - DAY))))
      .orderBy(asc(notification.createdAt))
      .limit(50);
    if (!rows.length) continue;
    const lines = rows.map((r) => `- ${r.key ?? ""} ${r.title ?? ""}: ${r.actor} ${r.verb}`);
    await sendMail({ to: u.email, subject: `Khira: ${rows.length} update${rows.length > 1 ? "s" : ""} for you`, text: `Hi ${u.name},\n\n${lines.join("\n")}\n\nOpen your inbox: ${appUrl()}/inbox` });
    sent++;
  }
  return { sent };
}

/** Pure: the no-AI standup text. */
export function plainStandup(yesterday: string[], today: string[], blocked: string[]) {
  const sec = (t: string, xs: string[]) => `*${t}*\n${xs.length ? xs.map((x) => `• ${x}`).join("\n") : "• —"}`;
  return [sec("Yesterday", yesterday), sec("Today", today), sec("Blocked", blocked)].join("\n");
}

/** Draft a standup per active person from yesterday's activity and current work. Editable until posted. */
export async function draftStandups(db: DB, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - DAY);
  const people = await db.select({ id: user.id, name: user.name }).from(user).where(and(ne(user.id, BOT_ID), ne(user.role, "guest")));
  let drafted = 0;
  for (const u of people) {
    const done = await db
      .selectDistinctOn([issue.id], { key: sql<string>`${project.key} || '-' || ${issue.number}`, title: issue.title, verb: activity.verb, id: issue.id })
      .from(activity)
      .innerJoin(issue, eq(issue.id, activity.issueId))
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(and(eq(activity.actorId, u.id), gte(activity.createdAt, since)))
      .limit(30);
    const current = await db
      .select({ key: sql<string>`${project.key} || '-' || ${issue.number}`, title: issue.title, id: issue.id })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
      .where(and(eq(issue.assigneeId, u.id), isNull(issue.deletedAt), eq(workflowStatus.category, "in_progress")))
      .limit(15);
    if (!done.length && !current.length) continue;
    const blocker = alias(issue, "blocker");
    const blockerStatus = alias(workflowStatus, "blocker_status");
    const blockedIds = current.length
      ? (
          await db
            .selectDistinct({ id: issueLink.toId })
            .from(issueLink)
            .innerJoin(blocker, eq(blocker.id, issueLink.fromId))
            .innerJoin(blockerStatus, eq(blockerStatus.id, blocker.statusId))
            .where(and(eq(issueLink.type, "blocks"), ne(blockerStatus.category, "done"), inArray(issueLink.toId, current.map((c) => c.id))))
        ).map((r) => r.id)
      : [];
    const y = done.map((d) => `${d.key} ${d.title}`);
    const t = current.map((c) => `${c.key} ${c.title}`);
    const b = current.filter((c) => blockedIds.includes(c.id)).map((c) => `${c.key} ${c.title} (blocked by another issue)`);
    let content = plainStandup(y, t, b);
    if (aiEnabled) {
      content = await prose(
        "Write a short async standup for this person in Slack mrkdwn with three sections: *Yesterday*, *Today*, *Blocked*. One bullet per item, plain language, keep issue keys. No preamble.",
        `Person: ${u.name}\nYesterday touched:\n${y.join("\n") || "(nothing)"}\nIn progress:\n${t.join("\n") || "(nothing)"}\nBlocked:\n${b.join("\n") || "(nothing)"}`,
      ).catch(() => content);
    }
    await db
      .insert(standup)
      .values({ userId: u.id, day, content })
      .onConflictDoNothing(); // a person's own edits win over a re-run
    drafted++;
  }
  return { drafted };
}

export async function postStandups(db: DB, now = new Date()) {
  const channel = (await getConfig("slack"))?.standupChannel;
  if (!channel) return { posted: 0 };
  const day = now.toISOString().slice(0, 10);
  const rows = await db
    .select({ id: standup.id, content: standup.content, name: user.name })
    .from(standup)
    .innerJoin(user, eq(user.id, standup.userId))
    .where(and(eq(standup.day, day), isNull(standup.postedAt)));
  for (const r of rows) {
    await postSlack(channel, `*${r.name}* — standup ${day}\n${r.content}`);
    await db.update(standup).set({ postedAt: new Date() }).where(eq(standup.id, r.id));
  }
  return { posted: rows.length };
}

