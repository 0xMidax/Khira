"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/shell";
import { Button, cn, Input, Select, STATUS_DOT } from "@/components/ui";
import { useTRPC } from "@/trpc/react";
import { ProjectIntegrations } from "./integrations";
import { ProjectAutomations } from "./automations";

const COLORS = ["slate", "blue", "violet", "green", "amber", "red"] as const;
const CATEGORY = { todo: "To do", in_progress: "In progress", done: "Done" } as const;
const PRI = ["urgent", "high", "medium", "low"] as const;

export default function ProjectSettings({ params }: { params: Promise<{ key: string }> }) {
  const key = use(params).key.toUpperCase();
  const trpc = useTRPC();
  const { me } = useShell();
  const project = useQuery(trpc.project.byKey.queryOptions({ key }));
  const [tab, setTab] = useState<"general" | "workflow" | "fields" | "sla" | "integrations" | "automation">("general");
  if (me.role !== "admin") return <p className="p-8 text-muted">Only admins can change project settings.</p>;
  if (!project.data) return <p className="p-8 text-muted">Loading…</p>;
  const p = project.data;
  const tabs = [
    ["general", "General"],
    ["workflow", "Workflow"],
    ["fields", "Custom fields"],
    ["sla", "SLAs"],
    ["integrations", "Integrations"],
    ["automation", "Automation"],
  ] as const;
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <Link href={`/p/${key}`} className="font-mono text-[12px] text-muted hover:text-ink">
        {key}
      </Link>
      <h1 className="mb-4 text-2xl font-semibold">Project settings</h1>
      <div role="tablist" className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[13px]", tab === t ? "border-accent font-medium" : "border-transparent text-muted hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "general" && <General project={p} />}
      {tab === "workflow" && <WorkflowEditor projectId={p.id} />}
      {tab === "fields" && <FieldsEditor projectId={p.id} />}
      {tab === "sla" && <SlaEditor projectId={p.id} />}
      {tab === "integrations" && <ProjectIntegrations projectId={p.id} projectKey={p.key} />}
      {tab === "automation" && <ProjectAutomations projectId={p.id} />}
    </main>
  );
}

function General({ project }: { project: { id: string; key: string; name: string; description: string | null } }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const update = useMutation(trpc.project.update.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.project.pathKey() }), toast.success("Saved")) }));
  const archive = useMutation(trpc.project.archive.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.project.pathKey() }), router.push("/projects")) }));
  return (
    <div className="space-y-8">
      <form
        className="max-w-lg space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          update.mutate({ id: project.id, name: String(f.get("name")), description: String(f.get("description")) });
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Name</span>
          <Input name="name" defaultValue={project.name} required maxLength={80} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Description</span>
          <Input name="description" defaultValue={project.description ?? ""} maxLength={2000} />
        </label>
        <Button variant="primary">Save</Button>
      </form>
      <MethodSwitch projectId={project.id} />
      <ImportCsv projectId={project.id} />
      <section className="rounded-lg border border-danger/40 p-4">
        <h2 className="mb-1 font-semibold">Archive project</h2>
        <p className="mb-3 text-[13px] text-muted">Hides it from the sidebar and search. Nothing is deleted.</p>
        <Button variant="danger" className="border border-danger/40" onClick={() => confirm(`Archive ${project.key}?`) && archive.mutate({ id: project.id, archived: true })}>
          Archive {project.key}
        </Button>
      </section>
    </div>
  );
}

function MethodSwitch({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const wf = useQuery(trpc.workflow.get.queryOptions({ projectId }));
  const save = useMutation(
    trpc.workflow.updateSettings.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.project.pathKey() }), qc.invalidateQueries({ queryKey: trpc.workflow.pathKey() }), toast.success("Saved")) }),
  );
  const method = wf.data?.settings.method ?? "scrum";
  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="mb-1 font-semibold">Board type</h2>
      <p className="mb-3 text-[13px] text-muted">Kanban is one continuous board with no sprints. Scrum adds a backlog, sprints and retros. Switching keeps all issues; existing sprints stay but are hidden in Kanban.</p>
      <Select value={method} onChange={(e) => save.mutate({ projectId, settings: { method: e.target.value as "kanban" | "scrum" } })} className="w-48" aria-label="Board type">
        <option value="kanban">Kanban</option>
        <option value="scrum">Scrum</option>
      </Select>
    </section>
  );
}

function ImportCsv({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const preview = useMutation(trpc.data.previewCsv.mutationOptions());
  const run = useMutation(
    trpc.data.importCsv.mutationOptions({
      onSuccess: (r) => {
        qc.invalidateQueries();
        toast.success(`Imported ${r.created} issues${r.errors.length ? `, skipped ${r.errors.length}` : ""}`);
        setCsv(null);
        preview.reset();
      },
    }),
  );
  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="mb-1 font-semibold">Import from CSV</h2>
      <p className="mb-3 text-[13px] text-muted">Works with JIRA’s “Export CSV (all fields)”. We read Summary, Description, Issue Type, Priority, Status, Assignee (email or name), Labels, Due Date and Story Points.</p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 5_000_000) return toast.error("That file is over 5 MB. Split it and import in parts.");
          const text = await file.text();
          setCsv(text);
          preview.mutate({ csv: text });
        }}
      />
      {preview.data && (
        <div className="mt-3 space-y-2 text-[13px]">
          <p>
            {preview.data.rows} rows. Columns we’ll use:{" "}
            {preview.data.columns
              .filter((c) => c.field)
              .map((c) => c.header)
              .join(", ") || "none"}
            .
          </p>
          <Button variant="primary" disabled={run.isPending || !preview.data.columns.some((c) => c.field === "title")} onClick={() => run.mutate({ projectId, csv: csv! })}>
            {run.isPending ? "Importing…" : `Import ${preview.data.rows} issues`}
          </Button>
          {run.data?.errors.length ? <p className="text-danger">Skipped rows: {run.data.errors.map((e) => `${e.row} (${e.message})`).join(", ")}</p> : null}
        </div>
      )}
    </section>
  );
}

function WorkflowEditor({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const wf = useQuery(trpc.workflow.get.queryOptions({ projectId }));
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.workflow.pathKey() }).then(() => qc.invalidateQueries({ queryKey: trpc.project.pathKey() }));
  const save = useMutation(trpc.workflow.saveStatus.mutationOptions({ onSuccess: refresh }));
  const reorder = useMutation(trpc.workflow.reorder.mutationOptions({ onSuccess: refresh }));
  const del = useMutation(trpc.workflow.deleteStatus.mutationOptions({ onSuccess: refresh }));
  const setT = useMutation(trpc.workflow.setTransitions.mutationOptions({ onSuccess: () => (refresh(), toast.success("Transitions saved")) }));
  const settings = useMutation(trpc.workflow.updateSettings.mutationOptions({ onSuccess: () => (refresh(), toast.success("Saved")) }));
  const [deleting, setDeleting] = useState<string | null>(null);
  if (!wf.data) return <p className="text-muted">Loading…</p>;
  const statuses = wf.data.statuses.map((s) => s.status);
  const allowed = new Set(wf.data.transitions.map((t) => `${t.fromStatusId}>${t.toStatusId}`));
  const restricted = allowed.size > 0;

  const toggle = (from: string, to: string) => {
    const next = restricted ? new Set(allowed) : new Set(statuses.flatMap((a) => statuses.filter((b) => b.id !== a.id).map((b) => `${a.id}>${b.id}`)));
    const k = `${from}>${to}`;
    if (next.has(k)) next.delete(k);
    else next.add(k);
    if (!next.size) return toast.error("Leave at least one transition, or use “Allow every move”.");
    setT.mutate({ projectId, transitions: [...next].map((x) => ({ from: x.split(">")[0], to: x.split(">")[1] })) });
  };
  const move = (i: number, d: -1 | 1) => {
    const order = statuses.map((s) => s.id);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    reorder.mutate({ projectId, order });
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 font-semibold">Statuses</h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {wf.data.statuses.map(({ status: s, issues }, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className={cn("size-2.5 rounded-full", STATUS_DOT[s.color])} aria-hidden />
              <form
                className="flex flex-1 flex-wrap items-center gap-2"
                onChange={(e) => {
                  const f = new FormData(e.currentTarget);
                  const name = String(f.get("name")).trim();
                  if (!name) return;
                  save.mutate({
                    projectId,
                    id: s.id,
                    name,
                    category: f.get("category") as "todo",
                    color: f.get("color") as "slate",
                    wipLimit: f.get("wip") ? Number(f.get("wip")) : null,
                  });
                }}
                onSubmit={(e) => e.preventDefault()}
              >
                <Input name="name" defaultValue={s.name} className="w-40" aria-label="Status name" maxLength={40} />
                <Select name="category" defaultValue={s.category} className="w-32" aria-label="Category">
                  {Object.entries(CATEGORY).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
                <Select name="color" defaultValue={s.color} className="w-24" aria-label="Color">
                  {COLORS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                <Input name="wip" type="number" min={1} max={999} defaultValue={s.wipLimit ?? ""} placeholder="WIP" className="w-20" aria-label="WIP limit" />
              </form>
              <span className="text-[12px] text-muted">{issues} issues</span>
              <Button size="sm" variant="ghost" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>
                <ArrowUp size={14} />
              </Button>
              <Button size="sm" variant="ghost" disabled={i === statuses.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>
                <ArrowDown size={14} />
              </Button>
              {deleting === s.id ? (
                <span className="flex items-center gap-1.5 text-[12px]">
                  Move issues to
                  <Select id={`mv-${s.id}`} className="h-7 w-32" aria-label="Move issues to">
                    {statuses
                      .filter((o) => o.id !== s.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => del.mutate({ projectId, id: s.id, moveTo: (document.getElementById(`mv-${s.id}`) as HTMLSelectElement).value }, { onSuccess: () => setDeleting(null) })}
                  >
                    Delete
                  </Button>
                  <Button size="sm" onClick={() => setDeleting(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} disabled={statuses.length <= 2} onClick={() => setDeleting(s.id)}>
                  <Trash2 size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button size="sm" className="mt-2" onClick={() => save.mutate({ projectId, name: "New status", category: "in_progress", color: "blue", wipLimit: null })}>
          Add status
        </Button>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-3">
          <h2 className="font-semibold">Transitions</h2>
          <span className="text-[13px] text-muted">{restricted ? "Only checked moves are allowed." : "Every move is allowed."}</span>
          {restricted && (
            <Button size="sm" className="ml-auto" onClick={() => setT.mutate({ projectId, transitions: [] })}>
              Allow every move
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="text-[13px]">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-[12px] font-medium text-muted">From ↓ / To →</th>
                {statuses.map((s) => (
                  <th key={s.id} className="px-2 py-1 font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statuses.map((from) => (
                <tr key={from.id} className="border-t border-line">
                  <th className="px-2 py-1 text-left font-medium">{from.name}</th>
                  {statuses.map((to) => (
                    <td key={to.id} className="px-2 py-1 text-center">
                      {from.id === to.id ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={!restricted || allowed.has(`${from.id}>${to.id}`)}
                          onChange={() => toggle(from.id, to.id)}
                          aria-label={`Allow ${from.name} to ${to.name}`}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Rules</h2>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!wf.data.settings.requireSubtasksDone}
            onChange={(e) => settings.mutate({ projectId, settings: { requireSubtasksDone: e.target.checked } })}
          />
          Block moving an issue to done while it has open subtasks
        </label>
        <label className="flex items-center gap-2">
          Flag issues as stale after
          <Input
            type="number"
            min={0}
            max={365}
            className="w-20"
            defaultValue={wf.data.settings.staleDays ?? 0}
            onBlur={(e) => settings.mutate({ projectId, settings: { staleDays: Number(e.target.value) || 0 } })}
            aria-label="Stale after days"
          />
          days without a status change (0 = off)
        </label>
      </section>
    </div>
  );
}

function FieldsEditor({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const fields = useQuery(trpc.extras.fields.queryOptions({ projectId }));
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.extras.fields.queryKey({ projectId }) });
  const save = useMutation(trpc.extras.saveField.mutationOptions({ onSuccess: refresh }));
  const del = useMutation(trpc.extras.deleteField.mutationOptions({ onSuccess: refresh }));
  const [type, setType] = useState<"text" | "number" | "select" | "date">("text");
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface empty:hidden">
        {fields.data?.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-3 py-2">
            <span className="font-medium">{f.name}</span>
            <span className="text-[12px] text-muted">
              {f.type}
              {f.options?.length ? `: ${f.options.join(", ")}` : ""}
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Delete ${f.name}`} onClick={() => confirm(`Delete ${f.name} and its values?`) && del.mutate({ id: f.id })}>
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const options = String(f.get("options") ?? "")
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean);
          save.mutate({ projectId, name: String(f.get("name")), type, options: type === "select" ? options : undefined }, { onSuccess: () => e.currentTarget?.reset() });
        }}
      >
        <Input name="name" placeholder="Field name, e.g. Customer" required maxLength={40} className="w-56" aria-label="Field name" />
        <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-28" aria-label="Field type">
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="select">Select</option>
          <option value="date">Date</option>
        </Select>
        {type === "select" && <Input name="options" placeholder="Options, comma separated" required className="w-64" aria-label="Options" />}
        <Button variant="primary">Add field</Button>
      </form>
    </div>
  );
}

function SlaEditor({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const wf = useQuery(trpc.workflow.get.queryOptions({ projectId }));
  const save = useMutation(trpc.workflow.updateSettings.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.workflow.pathKey() }), toast.success("SLA targets saved")) }));
  if (!wf.data) return null;
  const sla = wf.data.settings.sla ?? {};
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const next: Record<string, { responseHours: number; resolveHours: number }> = {};
        for (const p of PRI) {
          const r = Number(f.get(`${p}-r`));
          const s = Number(f.get(`${p}-s`));
          if (r > 0 || s > 0) next[p] = { responseHours: r, resolveHours: s };
        }
        save.mutate({ projectId, settings: { sla: next } });
      }}
    >
      <p className="text-[13px] text-muted">
        Targets in hours, per priority. Issues show a countdown, and the assignee (or project lead) gets a nudge when a target is missed. Leave blank for no target.
      </p>
      <table className="text-[13px]">
        <thead>
          <tr className="text-[12px] text-muted">
            <th className="pr-4 text-left font-medium">Priority</th>
            <th className="pr-4 text-left font-medium">First response</th>
            <th className="text-left font-medium">Resolve</th>
          </tr>
        </thead>
        <tbody>
          {PRI.map((p) => (
            <tr key={p}>
              <td className="py-1 pr-4 capitalize">{p}</td>
              <td className="py-1 pr-4">
                <Input name={`${p}-r`} type="number" min={0} step="0.5" defaultValue={sla[p]?.responseHours || ""} className="w-24" aria-label={`${p} response hours`} />
              </td>
              <td className="py-1">
                <Input name={`${p}-s`} type="number" min={0} step="0.5" defaultValue={sla[p]?.resolveHours || ""} className="w-24" aria-label={`${p} resolve hours`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="primary">Save targets</Button>
    </form>
  );
}
