import { and, eq, isNull, sql } from "drizzle-orm";
import { extractKeys } from "@/lib/issue-keys";
import type { DB } from "../db";
import { issue, project, projectChannel, workflowStatus } from "../db/schema";
import { getConfig } from "../integrations/config";
import { ensureBot, userByEmail, userBySetting } from "./bot";
import { addComment, createIssue, write } from "./issues";

const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

async function projectByKey(db: DB, key: string) {
  const [p] = await db.select({ id: project.id, key: project.key }).from(project).where(and(eq(project.key, key.toUpperCase()), isNull(project.archivedAt)));
  return p ?? null;
}

async function issueByKey(db: DB, key: string, number: number) {
  const [i] = await db
    .select({ id: issue.id, title: issue.title, number: issue.number, projectKey: project.key, statusName: workflowStatus.name, assigneeId: issue.assigneeId })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowStatus, eq(workflowStatus.id, issue.statusId))
    .where(and(eq(project.key, key), eq(issue.number, number), isNull(issue.deletedAt)));
  return i ?? null;
}

// ---------- Email (Postmark inbound JSON) ----------

export type InboundEmail = {
  From?: string;
  FromFull?: { Email: string; Name?: string };
  ToFull?: { Email: string }[];
  OriginalRecipient?: string;
  Subject?: string;
  TextBody?: string;
  StrippedTextReply?: string;
};

/**
 * - Reply to a notification ("Re: [KHR-12] …") from a team member → comment on KHR-12.
 * - Mail to khr@<domain> (or anything+khr@) → new issue in triage.
 */
export async function handleInboundEmail(db: DB, m: InboundEmail) {
  const sender = (m.FromFull?.Email ?? m.From ?? "").trim().toLowerCase();
  const subject = (m.Subject ?? "(no subject)").slice(0, 250);
  const body = (m.StrippedTextReply || m.TextBody || "").slice(0, 20_000);
  const member = sender ? await userByEmail(db, sender) : null;

  const replyKey = /\[([A-Z][A-Z0-9]{1,9})-(\d+)\]/i.exec(subject);
  if (replyKey && member && member.role !== "guest") {
    const i = await issueByKey(db, replyKey[1].toUpperCase(), Number(replyKey[2]));
    if (i && body.trim()) {
      await write(db, (tx) => addComment(tx, member.id, i.id, body.trim(), { source: "email" }));
      return { action: "commented" as const, key: `${i.projectKey}-${i.number}` };
    }
  }

  const domain = (await getConfig("email"))?.inboundDomain?.toLowerCase();
  const recipients = [m.OriginalRecipient, ...(m.ToFull ?? []).map((t) => t.Email)].filter(Boolean).map((e) => e!.toLowerCase());
  for (const r of recipients) {
    const [local, host] = r.split("@");
    if (domain && host !== domain) continue;
    const key = local.includes("+") ? local.split("+")[1] : local;
    const p = await projectByKey(db, key);
    if (!p) continue;
    const reporter = member?.id ?? (await ensureBot(db));
    const description = `${member ? "" : `From: ${sender}\n\n`}${body}`.trim();
    const row = await write(db, (tx) => createIssue(tx, reporter, { projectId: p.id, title: subject.replace(/^(re|fwd?):\s*/i, ""), description, type: "task", priority: "none", triage: true }, "email"));
    return { action: "created" as const, key: `${p.key}-${row.number}` };
  }
  return { action: "ignored" as const };
}

// ---------- Slack ----------

async function slackActor(db: DB, slackUserId: string) {
  return (await userBySetting(db, "slackUserId", slackUserId)) ?? (await ensureBot(db));
}

async function projectForChannel(db: DB, channelId: string) {
  const [c] = await db
    .select({ id: project.id, key: project.key })
    .from(projectChannel)
    .innerJoin(project, eq(project.id, projectChannel.projectId))
    .where(and(eq(projectChannel.kind, "slack"), eq(projectChannel.target, channelId)));
  return c ?? null;
}

const HELP = [
  "*Khira commands*",
  "`/khira create Fix the login page` — new issue in this channel's project",
  "`/khira create KHR Fix the login page` — new issue in project KHR",
  "`/khira KHR-12` — show an issue",
].join("\n");

/** Returns the ephemeral Slack response for `/khira …`. */
export async function handleSlashCommand(db: DB, f: { text: string; user_id: string; channel_id: string }) {
  const text = f.text.trim();
  const show = extractKeys(text)[0];
  if (show && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(text)) {
    const i = await issueByKey(db, show.key, show.number);
    if (!i) return { response_type: "ephemeral", text: `No issue ${show.key}-${show.number}.` };
    return { response_type: "in_channel", text: `*<${appUrl()}/i/${i.projectKey}-${i.number}|${i.projectKey}-${i.number}>* ${i.title} — _${i.statusName}_` };
  }
  const create = /^create\s+([\s\S]+)$/i.exec(text);
  if (!create) return { response_type: "ephemeral", text: HELP };

  let rest = create[1].trim();
  let p = null;
  const first = rest.split(/\s+/)[0];
  if (/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(first) && (p = await projectByKey(db, first))) rest = rest.slice(first.length).trim();
  p ??= await projectForChannel(db, f.channel_id);
  if (!p) return { response_type: "ephemeral", text: "Which project? Use `/khira create KEY title`, or connect this channel to a project in Khira's project settings." };
  if (!rest) return { response_type: "ephemeral", text: "Add a title: `/khira create KEY Fix the login page`" };
  const actor = await slackActor(db, f.user_id);
  const row = await write(db, (tx) =>
    createIssue(tx, actor, { projectId: p.id, title: rest.slice(0, 255), description: "", type: "task", priority: "none", triage: actor.startsWith("khira-bot") }, "slack"),
  );
  return { response_type: "in_channel", text: `Created *<${appUrl()}/i/${p.key}-${row.number}|${p.key}-${row.number}>* ${row.title}` };
}

/** Message shortcut "Create issue from message". */
export async function issueFromSlackMessage(db: DB, f: { user_id: string; channel_id: string; text: string; permalink?: string }) {
  const p = (await projectForChannel(db, f.channel_id)) ?? (await db.select({ id: project.id, key: project.key }).from(project).where(isNull(project.archivedAt)).orderBy(sql`${project.createdAt}`).limit(1))[0];
  if (!p) return null;
  const actor = await slackActor(db, f.user_id);
  const title = f.text.split("\n")[0].replace(/<[^>]+>/g, "").slice(0, 120) || "Issue from Slack";
  const description = `${f.text}${f.permalink ? `\n\n[View in Slack](${f.permalink})` : ""}`;
  const row = await write(db, (tx) => createIssue(tx, actor, { projectId: p.id, title, description, type: "task", priority: "none", triage: true }, "slack"));
  return `${p.key}-${row.number}`;
}

/** Link unfurls for /i/KEY-12 URLs. */
export async function unfurlsFor(db: DB, urls: string[]) {
  const out: Record<string, { title: string; text: string; title_link: string }> = {};
  for (const url of urls) {
    const m = /\/i\/([A-Za-z][A-Za-z0-9]*)-(\d+)/.exec(url);
    if (!m) continue;
    const i = await issueByKey(db, m[1].toUpperCase(), Number(m[2]));
    if (i) out[url] = { title: `${i.projectKey}-${i.number} ${i.title}`, text: `Status: ${i.statusName}`, title_link: url };
  }
  return out;
}
