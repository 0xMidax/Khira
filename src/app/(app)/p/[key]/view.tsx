"use client";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarDays, ChartGantt, Columns3, Globe, List, ListOrdered, MessagesSquare, Rocket, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Backlog } from "@/components/backlog";
import { Board } from "@/components/board";
import { CalendarView } from "@/components/calendar-view";
import { useOpenIssue } from "@/components/issue-modal";
import { ProjectSummary } from "@/components/project-summary";
import { TimelineView } from "@/components/timeline-view";
import { Avatar, Button, cn, Input, IssueKey, PRIORITY_META, PriorityIcon, Select, STATUS_DOT, TYPE_META, TypeIcon } from "@/components/ui";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/validators";
import { useTRPC } from "@/trpc/react";

export function ProjectView({ projectKey }: { projectKey: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const openIssue = useOpenIssue();
  const pathname = usePathname();
  const params = useSearchParams();
  const requestedView = (["summary", "timeline", "backlog", "calendar", "list"] as const).find((v) => v === params.get("view")) ?? "board";

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const project = useQuery(trpc.project.byKey.queryOptions({ key: projectKey }));
  const users = useQuery(trpc.user.list.queryOptions());
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  // Kanban projects are one continuous board: no backlog, no sprints, old Done cards tucked away.
  const kanban = project.data?.settings.method === "kanban";
  const view = kanban && requestedView === "backlog" ? "board" : requestedView;
  const showAllDone = params.get("done") === "all";
  const sprints = useQuery({ ...trpc.sprint.list.queryOptions({ projectId: project.data?.id ?? "00000000-0000-0000-0000-000000000000" }), enabled: !!project.data && !kanban });
  const activeSprint = kanban ? undefined : sprints.data?.find((s) => s.sprint.state === "active")?.sprint;
  const boardScoped = view === "board" && !!activeSprint && params.get("scope") !== "all";
  const assignee = params.get("assignee");
  const filter = {
    projectId: project.data?.id ?? "00000000-0000-0000-0000-000000000000",
    assigneeId: assignee === "none" ? null : assignee || undefined,
    type: (params.get("type") as (typeof ISSUE_TYPES)[number]) || undefined,
    priority: (params.get("priority") as (typeof PRIORITIES)[number]) || undefined,
    labelId: params.get("label") || undefined,
    sprintId: boardScoped ? activeSprint.id : undefined,
    resolvedSince: kanban && view === "board" && !showAllDone ? new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10) : undefined,
    q: debouncedQ || undefined,
  };
  const listOpts = trpc.issue.list.queryOptions(filter);
  const listView = view === "board" || view === "backlog" || view === "list";
  const issues = useQuery({ ...listOpts, enabled: !!project.data && listView, placeholderData: (prev) => prev });

  if (project.isError) return <p className="p-8 text-muted">There’s no project with the key {projectKey}. Check the URL, or pick a project from the sidebar.</p>;
  if (!project.data) return <p className="p-8 text-muted">Loading…</p>;
  const p = project.data;
  const filtered = !!(assignee || filter.type || filter.priority || filter.labelId || filter.q);

  return (
    <main className="flex h-[calc(100dvh-49px)] flex-col md:h-dvh">
      <header className="flex flex-wrap items-center gap-3 px-4 pt-5 pb-3 md:px-6">
        <div className="mr-auto">
          <div className="flex items-center gap-3">
            <span
              className="grid size-9 place-items-center rounded-xl font-mono text-[12px] font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]"
              style={{ background: `oklch(0.52 0.11 ${[...p.key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)})` }}
              aria-hidden
            >
              {p.key.slice(0, 2)}
            </span>
            <div>
              <h1 className="flex items-center gap-2 page-title">
                {p.name}
                <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-sans text-[11px] font-semibold tracking-normal text-muted">{kanban ? "Kanban" : "Scrum"}</span>
              </h1>
              <div className="font-mono text-[12px] text-muted">{p.key}{p.description ? ` · ${p.description}` : ""}</div>
            </div>
          </div>
        </div>
        <span data-tour="project-links" className="flex flex-wrap items-center gap-1">
        <Link href={`/p/${p.key}/releases`} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-sunken hover:text-ink">
          <Rocket size={14} /> Releases
        </Link>
        {!kanban && (
          <Link href={`/p/${p.key}/retro`} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-sunken hover:text-ink">
            <MessagesSquare size={14} /> Retro
          </Link>
        )}
        <Link href={`/p/${p.key}/reports`} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-sunken hover:text-ink">
          <BarChart3 size={14} /> Reports
        </Link>
        {p.myRole === "admin" && (
          <Link href={`/p/${p.key}/settings`} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-sunken hover:text-ink">
            <Settings size={14} /> Settings
          </Link>
        )}
        </span>
      </header>
      <div role="tablist" aria-label="View" data-tour="views" className="flex gap-1 overflow-x-auto border-b border-line px-4 md:px-6">
        {(
          [
            ["summary", "Summary", Globe],
            ["timeline", "Timeline", ChartGantt],
            ["backlog", "Backlog", ListOrdered],
            ["board", "Board", Columns3],
            ["calendar", "Calendar", CalendarDays],
            ["list", "List", List],
          ] as const
        )
          .filter(([v]) => !(kanban && v === "backlog"))
          .map(([v, label, Icon]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setParam("view", v === "board" ? null : v)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] transition-colors",
                view === v ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:border-line hover:text-ink",
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
      </div>

      {listView && <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-3 md:px-6" data-tour="filters">
        <Input value={q} onChange={(e) => (setQ(e.target.value), setParam("q", e.target.value || null))} placeholder="Filter by text or number" className="w-56" aria-label="Filter issues" />
        <Select value={assignee ?? ""} onChange={(e) => setParam("assignee", e.target.value || null)} className="w-40" aria-label="Assignee">
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {users.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select value={filter.type ?? ""} onChange={(e) => setParam("type", e.target.value || null)} className="w-32" aria-label="Type">
          <option value="">All types</option>
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_META[t].label}
            </option>
          ))}
        </Select>
        <Select value={filter.priority ?? ""} onChange={(e) => setParam("priority", e.target.value || null)} className="w-36" aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((x) => (
            <option key={x} value={x}>
              {PRIORITY_META[x].label}
            </option>
          ))}
        </Select>
        {p.labels.length > 0 && (
          <Select value={filter.labelId ?? ""} onChange={(e) => setParam("label", e.target.value || null)} className="w-36" aria-label="Label">
            <option value="">Any label</option>
            {p.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
        {view === "board" && kanban && (
          <Select value={showAllDone ? "all" : "recent"} onChange={(e) => setParam("done", e.target.value === "all" ? "all" : null)} className="w-48" aria-label="Done cards">
            <option value="recent">Done: last 14 days</option>
            <option value="all">Done: everything</option>
          </Select>
        )}
        {view === "board" && activeSprint && (
          <Select value={boardScoped ? "sprint" : "all"} onChange={(e) => setParam("scope", e.target.value === "all" ? "all" : null)} className="w-48" aria-label="Board scope">
            <option value="sprint">{activeSprint.name}</option>
            <option value="all">All issues</option>
          </Select>
        )}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => (setQ(""), router.replace(`${pathname}${view !== "board" ? `?view=${view}` : ""}`))}>
            Clear filters
          </Button>
        )}
      </div>}

      {view === "board" && boardScoped && activeSprint.goal && <p className="-mt-1 px-4 pb-2 text-[13px] text-muted md:px-6">Sprint goal: {activeSprint.goal}</p>}
      {view === "board" ? (
        <Board statuses={p.statuses} issues={issues.data ?? []} onOpen={openIssue} listKey={listOpts.queryKey} projectId={p.id} />
      ) : view === "backlog" ? (
        <Backlog projectId={p.id} statuses={p.statuses} issues={issues.data ?? []} onOpen={openIssue} listKey={listOpts.queryKey} />
      ) : view === "list" ? (
        <IssueTable statuses={p.statuses} issues={issues.data ?? []} onOpen={openIssue} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pt-4">
          {view === "summary" ? <ProjectSummary projectId={p.id} statuses={p.statuses} /> : view === "timeline" ? <TimelineView projectId={p.id} /> : <CalendarView projectId={p.id} />}
        </div>
      )}

    </main>
  );
}

function IssueTable({ statuses, issues, onOpen }: { statuses: { id: string; name: string; color: string }[]; issues: import("@/components/board").BoardIssue[]; onOpen: (k: string) => void }) {
  const order = useMemo(() => new Map(statuses.map((s, i) => [s.id, i])), [statuses]);
  const rows = useMemo(() => [...issues].sort((a, b) => order.get(a.statusId)! - order.get(b.statusId)!), [issues, order]);
  const statusOf = new Map(statuses.map((s) => [s.id, s]));
  if (!rows.length) return <p className="px-6 py-10 text-muted">No issues match these filters.</p>;
  return (
    <div className="overflow-auto px-4 pb-6 md:px-6">
      <table className="w-full sm:min-w-[720px] border-collapse rounded-lg bg-surface text-left">
        <thead className="text-[12px] text-muted">
          <tr className="border-b border-line">
            <th className="w-24 px-3 py-2 font-medium sm:w-28">Key</th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="hidden sm:table-cell w-36 px-3 py-2 font-medium">Status</th>
            <th className="hidden sm:table-cell w-28 px-3 py-2 font-medium">Priority</th>
            <th className="w-12 px-3 py-2 font-medium sm:w-40"><span className="sr-only sm:not-sr-only">Assignee</span></th>
            <th className="hidden sm:table-cell w-24 px-3 py-2 font-medium">Due</th>
            <th className="hidden sm:table-cell w-14 px-3 py-2 text-right font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const s = statusOf.get(i.statusId)!;
            return (
              <tr key={i.id} onClick={() => onOpen(i.key)} className="cursor-pointer border-b border-line last:border-0 hover:bg-sunken">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <TypeIcon type={i.type} size={14} />
                    <button className="hover:underline" onClick={(e) => (e.stopPropagation(), onOpen(i.key))}>
                      <IssueKey k={i.key} />
                    </button>
                  </span>
                </td>
                <td className="max-w-0 px-3 py-2"><span className="line-clamp-2 sm:line-clamp-1">{i.title}</span></td>
                <td className="hidden px-3 py-2 sm:table-cell">
                  <span className="flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", STATUS_DOT[s.color])} aria-hidden />
                    {s.name}
                  </span>
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">
                  <span className="flex items-center gap-1.5">
                    <PriorityIcon priority={i.priority} size={14} />
                    {PRIORITY_META[i.priority].label}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 truncate">
                    <Avatar name={i.assigneeName} image={i.assigneeImage} size={18} />
                    <span className="hidden sm:inline">{i.assigneeName ?? <span className="text-muted">Unassigned</span>}</span>
                  </span>
                </td>
                <td className="hidden px-3 py-2 text-muted sm:table-cell">{i.dueDate ?? ""}</td>
                <td className="hidden px-3 py-2 text-right text-muted sm:table-cell">{i.estimate ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
