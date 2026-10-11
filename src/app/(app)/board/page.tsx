"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Board } from "@/components/board";
import { useOpenIssue } from "@/components/issue-modal";
import { useShell } from "@/components/shell";
import { Button, cn, Input, PRIORITY_META, Select, TYPE_META } from "@/components/ui";
import { filterBoard } from "@/lib/board-filter";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/validators";
import { useTRPC } from "@/trpc/react";

function TeamBoardInner() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const openIssue = useOpenIssue();
  const pathname = usePathname();
  const params = useSearchParams();
  const { me } = useShell();

  // Filters live in the URL so a filtered board can be bookmarked or shared.
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const picked = params.get("projects")?.split(",").filter(Boolean) ?? [];
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  const projects = useQuery(trpc.project.list.queryOptions());
  const users = useQuery(trpc.user.list.queryOptions());
  const projectIds = projects.data?.filter((p) => picked.includes(p.key)).map((p) => p.id);
  const opts = trpc.issue.board.queryOptions({ projectIds: projectIds?.length ? projectIds : undefined });
  const data = useQuery({ ...opts, placeholderData: (p) => p });
  // Columns are status names merged across projects (To Do, In Progress, In Review, Testing, Done…).
  const columns = useQuery(trpc.issue.boardColumns.queryOptions());
  const move = useMutation(trpc.issue.moveToStatus.mutationOptions({ onSettled: () => qc.invalidateQueries({ queryKey: trpc.issue.pathKey() }) }));

  const filter = {
    q: debouncedQ,
    assignee: params.get("assignee") ?? undefined,
    type: params.get("type") ?? undefined,
    priority: params.get("priority") ?? undefined,
    label: params.get("label") ?? undefined,
  };
  const all = data.data ?? [];
  const issues = useMemo(
    () => filterBoard(data.data ?? [], filter, me.id).map((i) => ({ ...i, statusId: i.statusName.trim().toLowerCase() })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter is derived from the URL each render
    [data.data, debouncedQ, params, me.id],
  );
  const labels = [...new Set(all.flatMap((i) => i.labels.map((l) => l.name)))].sort((a, b) => a.localeCompare(b));
  const filtered = !!(debouncedQ || filter.assignee || filter.type || filter.priority || filter.label || picked.length);
  const toggle = (key: string) => setParam("projects", (picked.includes(key) ? picked.filter((x) => x !== key) : [...picked, key]).join(",") || null);

  return (
    <main className="flex h-[calc(100dvh-49px)] flex-col md:h-dvh">
      <header className="px-4 pt-5 pb-3 md:px-6">
        <h1 className="page-title">Team board</h1>
        <p className="text-[13px] text-muted">Every project on one board. Drag a card to change its status in its own project. Done shows the last 14 days.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 md:px-6" data-tour="filters">
        <Input value={q} onChange={(e) => (setQ(e.target.value), setParam("q", e.target.value || null))} placeholder="Filter by text or key" className="w-56" aria-label="Filter issues" />
        <Select value={filter.assignee ?? ""} onChange={(e) => setParam("assignee", e.target.value || null)} className="w-40" aria-label="Assignee">
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="none">Unassigned</option>
          {users.data
            ?.filter((u) => u.id !== me.id)
            .map((u) => (
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
        {labels.length > 0 && (
          <Select value={filter.label ?? ""} onChange={(e) => setParam("label", e.target.value || null)} className="w-36" aria-label="Label">
            <option value="">Any label</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        )}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => (setQ(""), router.replace(pathname))}>
            Clear filters
          </Button>
        )}
        <span className="ml-auto text-[12px] text-muted tabular-nums">
          {issues.length === all.length ? `${all.length} issues` : `${issues.length} of ${all.length} issues`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pb-3 md:px-6" aria-label="Projects">
        {projects.data?.map((p) => (
          <button
            key={p.id}
            aria-pressed={picked.includes(p.key)}
            onClick={() => toggle(p.key)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors",
              picked.includes(p.key) ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            <span className="font-mono">{p.key}</span> {p.name}
          </button>
        ))}
        {picked.length > 0 && (
          <button className="px-2 text-[12px] text-muted hover:text-ink" onClick={() => setParam("projects", null)}>
            All projects
          </button>
        )}
      </div>

      <Board
        statuses={columns.data ?? []}
        issues={issues}
        onOpen={openIssue}
        listKey={opts.queryKey}
        moveToColumn={(id, col) => move.mutateAsync({ id, name: columns.data?.find((c) => c.id === col)?.name ?? col })}
      />
    </main>
  );
}

export default function TeamBoard() {
  return (
    <Suspense>
      <TeamBoardInner />
    </Suspense>
  );
}
