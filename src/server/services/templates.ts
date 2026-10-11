import type { Tx } from "../db";
import type { issueTemplate } from "../db/schema";
import { createIssue, type Source } from "./issues";

/** Creates the issue (and its checklist as subtasks) from a template. */
export async function createFromTemplate(tx: Tx, actorId: string, t: typeof issueTemplate.$inferSelect, source: Source) {
  const today = new Date().toISOString().slice(0, 10);
  const title = t.fields.title.replaceAll("{{date}}", today);
  const parent = await createIssue(
    tx,
    actorId,
    {
      projectId: t.projectId,
      title,
      description: t.fields.description?.replaceAll("{{date}}", today),
      type: t.fields.type ?? "task",
      priority: t.fields.priority ?? "none",
      assigneeId: t.fields.assigneeId ?? null,
      labelIds: t.fields.labelIds,
    },
    source,
  );
  for (const sub of t.fields.subtasks ?? [])
    await createIssue(tx, actorId, { projectId: t.projectId, title: sub, type: "subtask", priority: "none", parentId: parent.id, assigneeId: t.fields.assigneeId ?? null }, source);
  return parent;
}
