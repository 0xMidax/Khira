"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, ChevronsUp, Hash, List, Lock, Pencil, Plus, Trash2, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { CreatedResolved, Empty } from "@/components/charts";
import { IssueResults } from "@/components/issue-results";
import { useShell } from "@/components/shell";
import { Button, cn, EmptyState, field, Input, Modal, PRIORITY_META } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

type W = { id: string; type: "count" | "list" | "byStatus" | "byAssignee" | "byPriority" | "createdVsResolved"; title: string; kql: string };
const TYPES: Record<W["type"], { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  count: { label: "Number", icon: Hash },
  list: { label: "Issue list", icon: List },
  byStatus: { label: "By status", icon: BarChart3 },
  byAssignee: { label: "By person", icon: Users },
  byPriority: { label: "By priority", icon: ChevronsUp },
  createdVsResolved: { label: "Created vs resolved", icon: TrendingUp },
};
const EXAMPLES = [
  ["Open work", "category != done"],
  ["Mine, open", "assignee = me() and category != done"],
  ["Open bugs", "type = bug and category != done"],
  ["Overdue", "due < startOfDay() and category != done"],
  ["High priority", "priority >= high and category != done"],
] as const;
const wide = (t: W["type"]) => t === "list" || t === "createdVsResolved";
// crypto.randomUUID only exists on https/localhost; a short random id is plenty for a widget.
const newId = () => Math.random().toString(36).slice(2, 10);

function WidgetBody({ w }: { w: W }) {
  const trpc = useTRPC();
  const q = useQuery({ ...trpc.dashboard.widget.queryOptions({ ...w, title: w.title.trim() || "Preview" }), retry: false, enabled: !!w.kql.trim() });
  const d = q.data as { count?: number; rows?: never[]; groups?: { name: string; value: number }[]; series?: { date: string; created: number; resolved: number }[] } | undefined;
  if (q.isError) return <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">This query doesn’t work: {q.error.message}</p>;
  if (!d) return <div className="h-16 animate-pulse rounded-lg bg-sunken" />;
  if (d.count !== undefined) return <span className="font-[family-name:var(--font-display)] text-5xl font-bold tabular-nums text-accent">{d.count}</span>;
  if (d.rows) return <IssueResults rows={d.rows} empty="Nothing matches right now." />;
  if (d.series) return <div className="h-56">{d.series.some((x) => x.created || x.resolved) ? <CreatedResolved data={d.series} /> : <Empty>No activity in the last 14 days.</Empty>}</div>;
  if (!d.groups?.length) return <p className="text-[13px] text-muted">Nothing matches right now.</p>;
  const max = Math.max(...d.groups.map((g) => g.value));
  return (
    <ul className="space-y-2">
      {d.groups.map((g) => (
        <li key={g.name} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2rem] items-center gap-2 text-[13px]">
          <span className="truncate">{w.type === "byPriority" ? (PRIORITY_META[g.name as keyof typeof PRIORITY_META]?.label ?? g.name) : g.name}</span>
          <span className="h-2 overflow-hidden rounded-full bg-sunken">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(g.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{g.value}</span>
        </li>
      ))}
    </ul>
  );
}

function WidgetCard({ w, onEdit }: { w: W; onEdit?: () => void }) {
  const Icon = TYPES[w.type].icon;
  return (
    <section className={cn("card group flex flex-col p-4", wide(w.type) && "md:col-span-2")}>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
          <Icon size={14} />
        </span>
        <h2 className="min-w-0 flex-1 truncate font-semibold">{w.title}</h2>
        {onEdit && (
          <button aria-label={`Edit ${w.title}`} className="rounded-md p-1.5 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-sunken hover:text-ink focus:opacity-100" onClick={onEdit}>
            <Pencil size={13} />
          </button>
        )}
      </header>
      <WidgetBody w={w} />
      <code className="mt-3 truncate pt-1 font-mono text-[11px] text-muted" title={w.kql}>
        {w.kql}
      </code>
    </section>
  );
}

function WidgetEditor({ initial, isNew, saving, error, onSave, onRemove, onClose }: { initial: W; isNew: boolean; saving: boolean; error: string | null; onSave: (w: W) => void; onRemove: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [preview, setPreview] = useState(initial);
  useEffect(() => {
    const t = setTimeout(() => setPreview(draft), 400);
    return () => clearTimeout(t);
  }, [draft]);
  return (
    <Modal open onClose={onClose} title={isNew ? "Add widget" : "Edit widget"} className="w-[min(760px,calc(100vw-32px))]">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...draft, title: draft.title.trim() || TYPES[draft.type].label });
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">Title</span>
          <Input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Open bugs" maxLength={80} />
        </label>
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-muted">Show as</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(TYPES) as W["type"][]).map((t) => {
              const Icon = TYPES[t].icon;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={draft.type === t}
                  onClick={() => setDraft({ ...draft, type: t })}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px] transition",
                    draft.type === t ? "border-accent bg-accent-soft font-medium text-ink" : "border-line hover:bg-sunken",
                  )}
                >
                  <Icon size={15} /> {TYPES[t].label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">Which issues (query)</span>
          <textarea value={draft.kql} onChange={(e) => setDraft({ ...draft, kql: e.target.value })} rows={2} required className={cn(field, "font-mono text-[13px]")} spellCheck={false} />
        </label>
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map(([label, kql]) => (
            <button key={kql} type="button" onClick={() => setDraft({ ...draft, kql })} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-muted hover:border-accent hover:text-accent">
              {label}
            </button>
          ))}
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted">Preview</div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-dashed border-line bg-bg p-3">
            <WidgetBody w={preview} />
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button type="button" variant="danger" size="sm" onClick={onRemove}>
              <Trash2 size={14} /> Remove
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving}>
            {isNew ? "Add widget" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const { me } = useShell();
  const d = useQuery(trpc.dashboard.get.queryOptions({ id }));
  const [editing, setEditing] = useState<{ w: W; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation(
    trpc.dashboard.save.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: trpc.dashboard.pathKey() });
        setEditing(null);
        toast.success("Dashboard saved");
      },
      onError: (e) => (editing ? setError(`Couldn’t save: ${e.message}`) : toast.error(e.message)),
    }),
  );
  const del = useMutation(trpc.dashboard.delete.mutationOptions({ onSuccess: () => router.push("/dashboards"), onError: (e) => toast.error(e.message) }));
  if (d.isError) return <p className="p-8 text-muted">This dashboard doesn’t exist or isn’t shared with you.</p>;
  if (!d.data) return <p className="p-8 text-muted">Loading…</p>;
  const mine = d.data.ownerId === me.id;
  const widgets = d.data.widgets as W[];
  const persist = (next: W[], extra?: { shared?: boolean }) => save.mutate({ id, name: d.data!.name, shared: extra?.shared ?? d.data!.shared, widgets: next });
  const open = (w: W, isNew: boolean) => (setError(null), setEditing({ w, isNew }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <Link href="/dashboards" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft size={14} /> Dashboards
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto page-title">{d.data.name}</h1>
        {mine ? (
          <>
            <Button size="sm" onClick={() => persist(widgets, { shared: !d.data!.shared })} title="Change who can see this dashboard">
              {d.data.shared ? <Users size={14} /> : <Lock size={14} />}
              {d.data.shared ? "Shared with the team" : "Only you"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => open({ id: newId(), type: "count", title: "", kql: "category != done" }, true)}>
              <Plus size={14} /> Add widget
            </Button>
            <Button size="sm" variant="ghost" aria-label="Delete dashboard" className="text-danger" onClick={() => confirm("Delete this dashboard?") && del.mutate({ id })}>
              <Trash2 size={14} />
            </Button>
          </>
        ) : (
          <span className="text-[13px] text-muted">Shared with you · read-only</span>
        )}
      </div>

      {widgets.length === 0 && <EmptyState title="This dashboard is empty">{mine ? "Use “Add widget” to show a count, a list or a chart of any issues." : undefined}</EmptyState>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => (
          <WidgetCard key={w.id} w={w} onEdit={mine ? () => open(w, false) : undefined} />
        ))}
      </div>

      {editing && (
        <WidgetEditor
          key={editing.w.id}
          initial={editing.w}
          isNew={editing.isNew}
          saving={save.isPending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(w) => persist(editing.isNew ? [...widgets, w] : widgets.map((x) => (x.id === w.id ? w : x)))}
          onRemove={() => persist(widgets.filter((x) => x.id !== editing.w.id))}
        />
      )}
    </main>
  );
}
