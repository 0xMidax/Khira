import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { type AutomationAction, type AutomationCondition, automationRule, automationRun, issue, issueLabel, projectChannel } from "../db/schema";
import { decrypt } from "@/lib/crypto";
import { postDiscord } from "../integrations/discord";
import { postSlack } from "../integrations/slack";
import { addComment, updateIssue, write } from "./issues";

export type IssueFacts = {
  id: string;
  key: string;
  title: string;
  type: string;
  priority: string;
  statusId: string;
  assigneeId: string | null;
  labelIds: string[];
};

export function conditionsMatch(conditions: AutomationCondition[], f: IssueFacts) {
  return conditions.every((c) => {
    const actual = c.field === "labelId" ? f.labelIds : c.field === "title" ? f.title : f[c.field];
    if (c.op === "contains") return typeof actual === "string" && !!c.value && actual.toLowerCase().includes(c.value.toLowerCase());
    const hit = Array.isArray(actual) ? actual.includes(c.value ?? "") : (actual ?? null) === (c.value ?? null);
    return c.op === "is" ? hit : !hit;
  });
}

export const fill = (text: string, f: IssueFacts) =>
  text.replaceAll("{{key}}", f.key).replaceAll("{{title}}", f.title).replaceAll("{{url}}", `${process.env.BETTER_AUTH_URL ?? ""}/i/${f.key}`);

export function triggerFor(verb: string, diff: Record<string, unknown> | null): Array<"created" | "updated" | "commented" | "statusChanged"> {
  if (verb === "created") return ["created"];
  if (verb === "commented") return ["commented"];
  if (verb === "updated") return diff?.statusId ? ["updated", "statusChanged"] : ["updated"];
  return [];
}

async function postToProjectChannels(projectId: string, text: string) {
  const channels = await db.select().from(projectChannel).where(eq(projectChannel.projectId, projectId));
  await Promise.all(channels.map((c) => (c.kind === "slack" ? postSlack(c.target, text) : postDiscord(decrypt(c.target), text))));
}

async function runAction(a: AutomationAction, actorId: string, f: IssueFacts, projectId: string) {
  switch (a.type) {
    case "assign":
      return write(db, (tx) => updateIssue(tx, actorId, { id: f.id, assigneeId: a.userId }, "automation"));
    case "setPriority":
      return write(db, (tx) => updateIssue(tx, actorId, { id: f.id, priority: a.priority }, "automation"));
    case "setStatus":
      return write(db, (tx) => updateIssue(tx, actorId, { id: f.id, statusId: a.statusId }, "automation"));
    case "addLabel":
      return write(db, (tx) => updateIssue(tx, actorId, { id: f.id, labelIds: [...new Set([...f.labelIds, a.labelId])] }, "automation"));
    case "comment":
      return write(db, (tx) => addComment(tx, actorId, f.id, fill(a.body, f), { source: "automation" }));
    case "notifySlack":
      return postToProjectChannels(projectId, fill(a.text, f));
  }
}

/** Runs matching rules for one activity. Activity created by automations never re-triggers rules (no loops). */
export async function runAutomations(args: { projectId: string; issueId: string; verb: string; diff: Record<string, unknown> | null; key: string }) {
  const triggers = triggerFor(args.verb, args.diff);
  if (!triggers.length) return;
  const rules = (await db.select().from(automationRule).where(and(eq(automationRule.projectId, args.projectId), eq(automationRule.enabled, true)))).filter((r) =>
    triggers.includes(r.trigger),
  );
  if (!rules.length) return;

  for (const rule of rules) {
    // Re-read per rule: an earlier rule may have changed the issue.
    const [i] = await db.select().from(issue).where(eq(issue.id, args.issueId));
    if (!i || i.deletedAt) return;
    const labelIds = (await db.select({ id: issueLabel.labelId }).from(issueLabel).where(eq(issueLabel.issueId, i.id))).map((l) => l.id);
    const facts: IssueFacts = { id: i.id, key: args.key, title: i.title, type: i.type, priority: i.priority, statusId: i.statusId, assigneeId: i.assigneeId, labelIds };
    if (!conditionsMatch(rule.conditions, facts)) continue;
    try {
      for (const a of rule.actions) await runAction(a, rule.createdBy, facts, args.projectId);
      await db.insert(automationRun).values({ ruleId: rule.id, issueId: i.id, ok: true });
    } catch (e) {
      await db.insert(automationRun).values({ ruleId: rule.id, issueId: i.id, ok: false, error: (e as Error).message.slice(0, 500) });
    }
  }
}

export { postToProjectChannels };
