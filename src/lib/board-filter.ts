export type BoardFilter = { q?: string; assignee?: string; type?: string; priority?: string; label?: string };
type Filterable = { key: string; title: string; type: string; priority: string; assigneeId: string | null; labels: { name: string }[] };

/** Client-side filters for the team board. assignee: "me" | "none" | a user id; label matches by name across projects. */
export function filterBoard<T extends Filterable>(issues: T[], f: BoardFilter, meId: string): T[] {
  const q = f.q?.trim().toLowerCase();
  const label = f.label?.toLowerCase();
  return issues.filter(
    (i) =>
      (!q || i.title.toLowerCase().includes(q) || i.key.toLowerCase().includes(q)) &&
      (!f.assignee || (f.assignee === "me" ? i.assigneeId === meId : f.assignee === "none" ? !i.assigneeId : i.assigneeId === f.assignee)) &&
      (!f.type || i.type === f.type) &&
      (!f.priority || i.priority === f.priority) &&
      (!label || i.labels.some((l) => l.name.toLowerCase() === label)),
  );
}
