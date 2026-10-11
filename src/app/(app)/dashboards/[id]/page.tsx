"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { toast } from "sonner";
import { CreatedResolved, Empty, SERIES } from "@/components/charts";
import { IssueResults } from "@/components/issue-results";
import { useShell } from "@/components/shell";
import { Button, cn, Input, Select } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

type W = { id: string; type: "count" | "list" | "byStatus" | "byAssignee" | "byPriority" | "createdVsResolved"; title: string; kql: string };
const TYPES: Record<W["type"], string> = { count: "Number", list: "Issue list", byStatus: "Bars by status", byAssignee: "Bars by person", byPriority: "Bars by priority", createdVsResolved: "Created vs resolved" };

function Widget({ w, onEdit }: { w: W; onEdit?: () => void }) {
  const trpc = useTRPC();
  const q = useQuery({ ...trpc.dashboard.widget.queryOptions(w), retry: false });
  const d = q.data as { count?: number; rows?: never[]; groups?: { name: string; value: number }[]; series?: { date: string; created: number; resolved: number }[] } | undefined;
  const max = Math.max(1, ...(d?.groups?.map((g) => g.value) ?? [1]));
  return (
    <section className={cn("flex flex-col rounded-lg border border-line bg-surface p-4", (w.type === "list" || w.type === "createdVsResolved") && "md:col-span-2")}>
      <header className="mb-2 flex items-center gap-2">
        <h2 className="flex-1 font-semibold">{w.title}</h2>
        {onEdit && (
          <button aria-label={`Edit ${w.title}`} className="text-muted hover:text-ink" onClick={onEdit}>
            <Pencil size={13} />
          </button>
        )}
      </header>
      {q.isError && <p className="text-[13px] text-danger">{q.error.message}</p>}
      {d?.count !== undefined && (
        <span className="text-4xl font-semibold tabular-nums">{d.count}</span>
      )}
      {d?.rows && <IssueResults rows={d.rows} empty="Nothing here." />}
      {d?.groups &&
        (d.groups.length ? (
          <ul className="space-y-1.5">
            {d.groups.map((g) => (
              <li key={g.name} className="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-[13px]">
                <span className="truncate">{g.name}</span>
                <span className="h-3 rounded-r" style={{ width: `${(g.value / max) * 100}%`, background: SERIES[0], minWidth: 4 }} aria-hidden />
                <span className="text-right tabular-nums">{g.value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">Nothing here.</p>
        ))}
      {d?.series && <div className="h-56">{d.series.some((x) => x.created || x.resolved) ? <CreatedResolved data={d.series} /> : <Empty>No activity in the last 14 days.</Empty>}</div>}
    </section>
  );
}

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const { me } = useShell();
  const d = useQuery(trpc.dashboard.get.queryOptions({ id }));
  const save = useMutation(trpc.dashboard.save.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.dashboard.pathKey() }), setEditing(null)) }));
  const del = useMutation(trpc.dashboard.delete.mutationOptions({ onSuccess: () => router.push("/dashboards") }));
  const [editing, setEditing] = useState<W | null>(null);
  if (d.isError) return <p className="p-8 text-muted">This dashboard doesn’t exist or isn’t shared with you.</p>;
  if (!d.data) return <p className="p-8 text-muted">Loading…</p>;
  const mine = d.data.ownerId === me.id;
  const widgets = d.data.widgets as W[];
  const persist = (next: W[], extra?: { shared?: boolean; name?: string }) =>
    save.mutate({ id, name: extra?.name ?? d.data!.name, shared: extra?.shared ?? d.data!.shared, widgets: next });

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{d.data.name}</h1>
        {mine && (
          <>
            <label className="flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={d.data.shared} onChange={(e) => persist(widgets, { shared: e.target.checked })} /> Shared with the team
            </label>
            <Button size="sm" onClick={() => setEditing({ id: crypto.randomUUID().slice(0, 8), type: "count", title: "", kql: "category != done" })}>
              <Plus size={14} /> Add widget
            </Button>
            <Button size="sm" variant="danger" onClick={() => confirm("Delete this dashboard?") && del.mutate({ id })}>
              <Trash2 size={14} />
            </Button>
          </>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => (
          <Widget key={w.id} w={w} onEdit={mine ? () => setEditing(w) : undefined} />
        ))}
      </div>
      {editing && (
        <form
          className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-2xl space-y-2 rounded-xl border border-line bg-surface p-4 shadow-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            const exists = widgets.some((w) => w.id === editing.id);
            persist(exists ? widgets.map((w) => (w.id === editing.id ? editing : w)) : [...widgets, editing]);
            toast.success("Dashboard saved");
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Widget title" required maxLength={80} className="w-64" aria-label="Widget title" />
            <Select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as W["type"] })} className="w-48" aria-label="Widget type">
              {Object.entries(TYPES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <Input value={editing.kql} onChange={(e) => setEditing({ ...editing, kql: e.target.value })} className="font-mono text-[13px]" aria-label="KQL query" />
          <div className="flex gap-2">
            <Button variant="primary" size="sm">
              Save widget
            </Button>
            <Button type="button" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            {widgets.some((w) => w.id === editing.id) && (
              <Button type="button" size="sm" variant="danger" className="ml-auto" onClick={() => persist(widgets.filter((w) => w.id !== editing.id))}>
                Remove widget
              </Button>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
