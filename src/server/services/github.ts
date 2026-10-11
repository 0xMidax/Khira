import { and, eq, inArray, isNull } from "drizzle-orm";
import { extractKeys } from "@/lib/issue-keys";
import type { DB } from "../db";
import { githubLink, issue, project, workflowStatus } from "../db/schema";
import { ensureBot, userBySetting } from "./bot";
import { logActivity, updateIssue, write } from "./issues";

type Ref = { kind: "pr" | "commit" | "branch"; repo: string; ref: string; title: string | null; url: string; state: string | null; text: string; login?: string };

/** The parts of GitHub webhook payloads we read. Everything is optional: payloads are external input. */
export type GhPayload = {
  action?: string;
  ref?: string;
  ref_type?: string;
  repository?: { full_name?: string; html_url?: string };
  sender?: { login?: string };
  pull_request?: { number: number; title: string; body?: string | null; html_url: string; state: string; merged?: boolean; head?: { ref?: string }; user?: { login?: string } };
  commits?: { id: string; message: string; url: string; author?: { username?: string } }[];
};

/** Turn one GitHub webhook payload into link refs. Unknown events → []. */
export function refsFromEvent(event: string, p: GhPayload): (Ref & { merged?: boolean; opened?: boolean })[] {
  const repo: string = p.repository?.full_name ?? "";
  if (event === "pull_request" && p.pull_request) {
    const pr = p.pull_request;
    const merged = p.action === "closed" && !!pr.merged;
    return [
      {
        kind: "pr",
        repo,
        ref: String(pr.number),
        title: pr.title,
        url: pr.html_url,
        state: merged ? "merged" : pr.state,
        text: `${pr.title}\n${pr.body ?? ""}\n${pr.head?.ref ?? ""}`,
        login: pr.user?.login,
        merged,
        opened: p.action === "opened" || p.action === "reopened" || p.action === "ready_for_review",
      },
    ];
  }
  if (event === "push" && Array.isArray(p.commits)) {
    const branch = String(p.ref ?? "").replace("refs/heads/", "");
    return p.commits.map((c) => ({
      kind: "commit" as const,
      repo,
      ref: String(c.id).slice(0, 40),
      title: String(c.message).split("\n")[0].slice(0, 200),
      url: c.url,
      state: null,
      text: `${c.message}\n${branch}`,
      login: c.author?.username,
    }));
  }
  if (event === "create" && p.ref_type === "branch") {
    const ref = String(p.ref ?? "");
    return [{ kind: "branch", repo, ref, title: ref, url: `${p.repository?.html_url}/tree/${encodeURIComponent(ref)}`, state: null, text: ref, login: p.sender?.login }];
  }
  return [];
}

type St = { id: string; name: string; category: "todo" | "in_progress" | "done"; position: number };
type GhSettings = NonNullable<import("../db/schema").ProjectSettings["github"]>;
const RANK = { todo: 0, in_progress: 1, done: 2 } as const;

/**
 * Where GitHub activity moves an issue. undefined = sensible default, null = "don't move".
 * Defaults: branch created → first in-progress status; PR opened → a "review" status if the workflow has one; merged → first done status.
 */
export function githubTransitions(statuses: St[], gh: GhSettings | undefined) {
  const sorted = [...statuses].sort((a, b) => a.position - b.position);
  const pick = (v: string | null | undefined, fallback: St | undefined) => (v === null ? null : v !== undefined ? (sorted.find((s) => s.id === v)?.id ?? null) : (fallback?.id ?? null));
  return {
    branch: pick(gh?.onBranchCreated, sorted.find((s) => s.category === "in_progress")),
    prOpened: pick(gh?.onPrOpened, sorted.find((s) => s.category === "in_progress" && /review/i.test(s.name))),
    merged: pick(gh?.onPrMerged, sorted.find((s) => s.category === "done")),
  };
}

/** Only ever move work forward (by category, then workflow position), so a late push can't reopen a Done issue. */
export function isForward(statuses: St[], fromId: string, toId: string) {
  const a = statuses.find((s) => s.id === fromId);
  const b = statuses.find((s) => s.id === toId);
  if (!a || !b || a.id === b.id) return false;
  return RANK[b.category] > RANK[a.category] || (RANK[b.category] === RANK[a.category] && b.position > a.position);
}

export async function handleGithubEvent(db: DB, event: string, payload: GhPayload) {
  const refs = refsFromEvent(event, payload);
  if (!refs.length) return { linked: 0 };
  const projects = await db.select({ id: project.id, key: project.key, settings: project.settings }).from(project).where(isNull(project.archivedAt));
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const statusCache = new Map<string, St[]>();
  // Always query through the caller's transaction: a second connection would deadlock a single-connection DB.
  const statusesOf = async (q: Pick<DB, "select">, projectId: string) => {
    if (!statusCache.has(projectId))
      statusCache.set(
        projectId,
        await q
          .select({ id: workflowStatus.id, name: workflowStatus.name, category: workflowStatus.category, position: workflowStatus.position })
          .from(workflowStatus)
          .where(eq(workflowStatus.projectId, projectId)),
      );
    return statusCache.get(projectId)!;
  };
  let linked = 0;
  for (const r of refs) {
    const keys = extractKeys(r.text, new Set(byKey.keys()));
    if (!keys.length) continue;
    const person = r.login ? await userBySetting(db, "githubLogin", r.login) : null;
    const actorId = person ?? (await ensureBot(db));
    for (const k of keys) {
      const p = byKey.get(k.key)!;
      const repos = p.settings.github?.repos ?? [];
      if (repos.length && !repos.some((x) => x.toLowerCase() === r.repo.toLowerCase())) continue;
      const [i] = await db
        .select({ id: issue.id, statusId: issue.statusId, assigneeId: issue.assigneeId })
        .from(issue)
        .where(and(eq(issue.projectId, p.id), eq(issue.number, k.number), isNull(issue.deletedAt)));
      if (!i) continue;
      await write(db, async (tx) => {
        const [existing] = await tx
          .select({ id: githubLink.id })
          .from(githubLink)
          .where(and(eq(githubLink.issueId, i.id), eq(githubLink.kind, r.kind), eq(githubLink.repo, r.repo), eq(githubLink.ref, r.ref)));
        await tx
          .insert(githubLink)
          .values({ issueId: i.id, kind: r.kind, repo: r.repo, ref: r.ref, title: r.title, url: r.url, state: r.state })
          .onConflictDoUpdate({ target: [githubLink.issueId, githubLink.kind, githubLink.repo, githubLink.ref], set: { title: r.title, state: r.state, updatedAt: new Date() } });
        if (!existing)
          await logActivity(tx, { actorId, projectId: p.id, issueId: i.id, verb: "linked", source: "github", diff: { github: { from: null, to: `${r.kind} ${r.repo}#${r.ref}` } } });
        const statuses = await statusesOf(tx, p.id);
        const t = githubTransitions(statuses, p.settings.github);
        const startsWork = r.kind === "branch" || (r.kind === "pr" && r.opened);
        const target = r.kind === "branch" && !existing ? t.branch : r.kind === "pr" ? (r.merged ? t.merged : r.opened ? t.prOpened : null) : null;
        const patch: { statusId?: string; assigneeId?: string } = {};
        if (target && isForward(statuses, i.statusId, target)) patch.statusId = target;
        // Whoever starts the work on GitHub owns it, if nobody does yet (only for linked accounts, never the bot).
        if (startsWork && person && !i.assigneeId && p.settings.github?.autoAssign !== false) patch.assigneeId = person;
        // Workflow transition rules still apply; if they forbid the move we keep the link and skip the move.
        if (Object.keys(patch).length)
          await updateIssue(tx, actorId, { id: i.id, ...patch }, "github").catch((e) => console.warn("github transition skipped:", (e as Error).message));
      });
      linked++;
    }
  }
  return { linked };
}

export async function linksFor(db: DB, issueIds: string[]) {
  return issueIds.length ? db.select().from(githubLink).where(inArray(githubLink.issueId, issueIds)) : [];
}
