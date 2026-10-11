"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input, Modal, Select } from "@/components/ui";
import { describeRecurrence, type Recurrence } from "@/lib/recurrence";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/validators";
import { useTRPC } from "@/trpc/react";

type Condition = { field: "type" | "priority" | "statusId" | "assigneeId" | "labelId" | "title"; op: "is" | "isNot" | "contains"; value: string | null };
type Action =
  | { type: "assign"; userId: string | null }
  | { type: "setPriority"; priority: (typeof PRIORITIES)[number] }
  | { type: "setStatus"; statusId: string }
  | { type: "addLabel"; labelId: string }
  | { type: "comment"; body: string }
  | { type: "notifySlack"; text: string };

const TRIGGERS = { created: "An issue is created", updated: "An issue is changed", statusChanged: "An issue changes status", commented: "Someone comments" } as const;
const FIELDS = { type: "Type", priority: "Priority", statusId: "Status", assigneeId: "Assignee", labelId: "Label", title: "Title" } as const;

const PRESETS: { name: string; trigger: keyof typeof TRIGGERS; conditions: Condition[]; actions: Action[] }[] = [
  { name: "Flag urgent bugs in chat", trigger: "created", conditions: [{ field: "type", op: "is", value: "bug" }, { field: "priority", op: "is", value: "urgent" }], actions: [{ type: "notifySlack", text: "🚨 Urgent bug {{key}}: {{title}} {{url}}" }] },
  { name: "Unassign when moved back to To Do", trigger: "statusChanged", conditions: [], actions: [{ type: "assign", userId: null }] },
];

export function ProjectAutomations({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const rules = useQuery(trpc.automation.rules.queryOptions({ projectId }));
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.automation.pathKey() });
  const save = useMutation(trpc.automation.saveRule.mutationOptions({ onSuccess: () => (refresh(), toast.success("Rule saved")) }));
  const del = useMutation(trpc.automation.deleteRule.mutationOptions({ onSuccess: refresh }));
  const [editing, setEditing] = useState<null | { id?: string; name: string; trigger: keyof typeof TRIGGERS; conditions: Condition[]; actions: Action[] }>(null);

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-semibold">Automation rules</h2>
          <Button size="sm" className="ml-auto" onClick={() => setEditing({ name: "", trigger: "created", conditions: [], actions: [{ type: "comment", body: "" }] })}>
            <Plus size={14} /> New rule
          </Button>
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {rules.data?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <input type="checkbox" checked={r.enabled} aria-label={`Enable ${r.name}`} onChange={(e) => save.mutate({ ...r, enabled: e.target.checked })} />
              <button className="flex-1 text-left" onClick={() => setEditing({ id: r.id, name: r.name, trigger: r.trigger, conditions: r.conditions, actions: r.actions })}>
                <span className="block font-medium">{r.name}</span>
                <span className="block text-[12px] text-muted">
                  When {TRIGGERS[r.trigger].toLowerCase()}
                  {r.conditions.length ? ` and ${r.conditions.length} condition${r.conditions.length > 1 ? "s" : ""} match` : ""}, run {r.actions.length} action{r.actions.length > 1 ? "s" : ""}
                </span>
              </button>
              <RunLog ruleId={r.id} />
              <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete “${r.name}”?`) && del.mutate({ id: r.id })}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
          {rules.data?.length === 0 && (
            <li className="px-3 py-4 text-[13px] text-muted">
              No rules yet. Start from one:{" "}
              {PRESETS.map((p) => (
                <button key={p.name} className="mr-3 text-accent hover:underline" onClick={() => setEditing({ ...p })}>
                  {p.name}
                </button>
              ))}
            </li>
          )}
        </ul>
      </section>
      <Templates projectId={projectId} />
      {editing && <RuleEditor projectId={projectId} initial={editing} onClose={() => setEditing(null)} onSave={(r) => save.mutate({ projectId, ...r }, { onSuccess: () => setEditing(null) })} />}
    </div>
  );
}

function RunLog({ ruleId }: { ruleId: string }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const runs = useQuery({ ...trpc.automation.runs.queryOptions({ ruleId }), enabled: open });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)} className="relative text-[12px]">
      <summary className="cursor-pointer text-muted hover:text-ink">History</summary>
      <ul className="absolute right-0 z-10 mt-1 w-72 space-y-1 rounded-md border border-line bg-surface p-2 shadow-md">
        {runs.data?.length === 0 && <li className="text-muted">Hasn’t run yet.</li>}
        {runs.data?.map((r) => (
          <li key={r.id} className={r.ok ? "" : "text-danger"}>
            {new Date(r.createdAt).toLocaleString()} · {r.ok ? "ok" : r.error}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RuleEditor({
  projectId,
  initial,
  onClose,
  onSave,
}: {
  projectId: string;
  initial: { id?: string; name: string; trigger: keyof typeof TRIGGERS; conditions: Condition[]; actions: Action[] };
  onClose: () => void;
  onSave: (r: { id?: string; name: string; trigger: keyof typeof TRIGGERS; conditions: Condition[]; actions: Action[] }) => void;
}) {
  const trpc = useTRPC();
  const [r, setR] = useState(initial);
  const users = useQuery(trpc.user.list.queryOptions());
  const wf = useQuery(trpc.workflow.get.queryOptions({ projectId }));
  const project = useQuery(trpc.project.list.queryOptions());
  const labels = useQuery({ ...trpc.project.byKey.queryOptions({ key: project.data?.find((p) => p.id === projectId)?.key ?? "" }), enabled: !!project.data });
  const statuses = wf.data?.statuses.map((s) => s.status) ?? [];

  const valueInput = (c: Condition, set: (v: string | null) => void) => {
    const opts: [string, string][] | null =
      c.field === "type"
        ? ISSUE_TYPES.map((t) => [t, t])
        : c.field === "priority"
          ? PRIORITIES.map((p) => [p, p])
          : c.field === "statusId"
            ? statuses.map((s) => [s.id, s.name])
            : c.field === "assigneeId"
              ? [["", "Unassigned"], ...(users.data ?? []).map((u) => [u.id, u.name] as [string, string])]
              : c.field === "labelId"
                ? (labels.data?.labels ?? []).map((l) => [l.id, l.name])
                : null;
    return opts && c.op !== "contains" ? (
      <Select value={c.value ?? ""} onChange={(e) => set(e.target.value || null)} className="w-40" aria-label="Value">
        <option value="" disabled={c.field !== "assigneeId"}>
          Pick…
        </option>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    ) : (
      <Input value={c.value ?? ""} onChange={(e) => set(e.target.value)} className="w-40" aria-label="Value" />
    );
  };

  const actionInput = (a: Action, set: (a: Action) => void) => {
    switch (a.type) {
      case "assign":
        return (
          <Select value={a.userId ?? ""} onChange={(e) => set({ type: "assign", userId: e.target.value || null })} className="w-44" aria-label="Assignee">
            <option value="">Nobody (unassign)</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        );
      case "setPriority":
        return (
          <Select value={a.priority} onChange={(e) => set({ type: "setPriority", priority: e.target.value as Action extends { priority: infer P } ? P : never })} className="w-32" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        );
      case "setStatus":
        return (
          <Select value={a.statusId} onChange={(e) => set({ type: "setStatus", statusId: e.target.value })} className="w-40" aria-label="Status">
            <option value="" disabled>
              Pick…
            </option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        );
      case "addLabel":
        return (
          <Select value={a.labelId} onChange={(e) => set({ type: "addLabel", labelId: e.target.value })} className="w-40" aria-label="Label">
            <option value="" disabled>
              Pick…
            </option>
            {labels.data?.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        );
      case "comment":
        return <Input value={a.body} onChange={(e) => set({ type: "comment", body: e.target.value })} className="min-w-64 flex-1" placeholder="Comment text ({{key}}, {{title}}, {{url}})" aria-label="Comment" />;
      case "notifySlack":
        return <Input value={a.text} onChange={(e) => set({ type: "notifySlack", text: e.target.value })} className="min-w-64 flex-1" placeholder="Message ({{key}}, {{title}}, {{url}})" aria-label="Message" />;
    }
  };
  const blank: Record<Action["type"], Action> = {
    assign: { type: "assign", userId: null },
    setPriority: { type: "setPriority", priority: "high" },
    setStatus: { type: "setStatus", statusId: "" },
    addLabel: { type: "addLabel", labelId: "" },
    comment: { type: "comment", body: "" },
    notifySlack: { type: "notifySlack", text: "" },
  };

  return (
    <Modal open onClose={onClose} title={r.id ? "Edit rule" : "New rule"} className="w-[min(760px,calc(100vw-32px))]">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(r);
        }}
      >
        <Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} required placeholder="Rule name" maxLength={80} aria-label="Rule name" />
        <div>
          <div className="mb-1 text-[12px] font-medium text-muted">When</div>
          <Select value={r.trigger} onChange={(e) => setR({ ...r, trigger: e.target.value as keyof typeof TRIGGERS })} className="w-64" aria-label="Trigger">
            {Object.entries(TRIGGERS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-medium text-muted">If (all must match)</div>
          {r.conditions.map((c, i) => (
            <div key={i} className="mb-1.5 flex flex-wrap gap-1.5">
              <Select
                value={c.field}
                onChange={(e) => setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value as Condition["field"], value: null } : x)) })}
                className="w-32"
                aria-label="Field"
              >
                {Object.entries(FIELDS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              <Select value={c.op} onChange={(e) => setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as Condition["op"] } : x)) })} className="w-28" aria-label="Operator">
                <option value="is">is</option>
                <option value="isNot">is not</option>
                {c.field === "title" && <option value="contains">contains</option>}
              </Select>
              {valueInput(c, (v) => setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? { ...x, value: v } : x)) }))}
              <Button type="button" size="sm" variant="ghost" aria-label="Remove condition" onClick={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })}>
                <X size={14} />
              </Button>
            </div>
          ))}
          <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => setR({ ...r, conditions: [...r.conditions, { field: "type", op: "is", value: "bug" }] })}>
            Add condition
          </button>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-medium text-muted">Then</div>
          {r.actions.map((a, i) => (
            <div key={i} className="mb-1.5 flex flex-wrap gap-1.5">
              <Select value={a.type} onChange={(e) => setR({ ...r, actions: r.actions.map((x, j) => (j === i ? blank[e.target.value as Action["type"]] : x)) })} className="w-40" aria-label="Action">
                <option value="assign">Assign to</option>
                <option value="setPriority">Set priority</option>
                <option value="setStatus">Move to status</option>
                <option value="addLabel">Add label</option>
                <option value="comment">Add comment</option>
                <option value="notifySlack">Post to chat</option>
              </Select>
              {actionInput(a, (na) => setR({ ...r, actions: r.actions.map((x, j) => (j === i ? na : x)) }))}
              <Button type="button" size="sm" variant="ghost" aria-label="Remove action" disabled={r.actions.length === 1} onClick={() => setR({ ...r, actions: r.actions.filter((_, j) => j !== i) })}>
                <X size={14} />
              </Button>
            </div>
          ))}
          <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => setR({ ...r, actions: [...r.actions, blank.comment] })}>
            Add action
          </button>
        </div>
        <p className="text-[12px] text-muted">Changes made by rules never trigger other rules, so they can’t loop.</p>
        <div className="flex justify-end">
          <Button variant="primary">Save rule</Button>
        </div>
      </form>
    </Modal>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Templates({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const list = useQuery(trpc.automation.templates.queryOptions({ projectId }));
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.automation.templates.queryKey({ projectId }) });
  const save = useMutation(trpc.automation.saveTemplate.mutationOptions({ onSuccess: () => (refresh(), toast.success("Template saved")) }));
  const del = useMutation(trpc.automation.deleteTemplate.mutationOptions({ onSuccess: refresh }));
  const createNow = useMutation(trpc.automation.useTemplate.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.issue.pathKey() }), toast.success("Issue created")) }));
  const setRec = useMutation(trpc.automation.setRecurring.mutationOptions({ onSuccess: () => (refresh(), toast.success("Schedule saved")) }));
  const [scheduling, setScheduling] = useState<string | null>(null);

  return (
    <section>
      <h2 className="mb-1 font-semibold">Templates & recurring issues</h2>
      <p className="mb-3 text-[13px] text-muted">Save an issue shape (with a checklist that becomes subtasks) and create it on demand or on a schedule. Use {"{{date}}"} in the title for today’s date.</p>
      <ul className="mb-3 divide-y divide-line rounded-lg border border-line bg-surface empty:hidden">
        {list.data?.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t.name}</span>
              <span className="block text-[12px] text-muted">
                “{t.fields.title}”{t.fields.subtasks?.length ? ` + ${t.fields.subtasks.length} subtasks` : ""}
                {t.recurring && ` · ${describeRecurrence(t.recurring.rule)} · next ${new Date(t.recurring.nextRunAt).toLocaleString()}`}
              </span>
            </span>
            <Button size="sm" onClick={() => createNow.mutate({ id: t.id })}>
              Create now
            </Button>
            <Button size="sm" onClick={() => setScheduling(t.id)}>
              {t.recurring ? "Change schedule" : "Repeat…"}
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => del.mutate({ id: t.id })}>
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2 rounded-lg border border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const subtasks = String(f.get("subtasks") ?? "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          save.mutate(
            {
              projectId,
              name: String(f.get("name")),
              fields: { title: String(f.get("title")), type: f.get("type") as (typeof ISSUE_TYPES)[number], priority: f.get("priority") as (typeof PRIORITIES)[number], subtasks },
            },
            { onSuccess: () => e.currentTarget?.reset() },
          );
        }}
      >
        <div className="flex flex-wrap gap-2">
          <Input name="name" placeholder="Template name, e.g. Release checklist" required maxLength={80} className="w-64" aria-label="Template name" />
          <Input name="title" placeholder="Issue title, e.g. Deploy {{date}}" required maxLength={255} className="w-72" aria-label="Issue title" />
          <Select name="type" defaultValue="task" className="w-28" aria-label="Type">
            {ISSUE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Select name="priority" defaultValue="none" className="w-28" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </div>
        <textarea name="subtasks" rows={3} placeholder={"Checklist, one per line (optional)\nRun migrations\nSmoke test"} className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5" aria-label="Checklist" />
        <Button variant="primary" size="sm">
          Save template
        </Button>
      </form>

      <Modal open={!!scheduling} onClose={() => setScheduling(null)} title="Repeat this issue">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const freq = f.get("freq") as Recurrence["freq"];
            const rule: Recurrence = {
              freq,
              interval: Number(f.get("interval")) || 1,
              hour: Number(f.get("hour")),
              ...(freq === "weekly" ? { weekday: Number(f.get("weekday")) } : {}),
              ...(freq === "monthly" ? { monthDay: Number(f.get("monthDay")) } : {}),
            };
            setRec.mutate({ templateId: scheduling!, rule }, { onSuccess: () => setScheduling(null) });
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            Every
            <Input name="interval" type="number" min={1} max={52} defaultValue={1} className="w-16" aria-label="Interval" />
            <Select name="freq" defaultValue="weekly" className="w-28" aria-label="Frequency">
              <option value="daily">day(s)</option>
              <option value="weekly">week(s)</option>
              <option value="monthly">month(s)</option>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            On (weekly)
            <Select name="weekday" defaultValue={1} className="w-36" aria-label="Weekday">
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
            or day (monthly)
            <Input name="monthDay" type="number" min={1} max={28} defaultValue={1} className="w-16" aria-label="Day of month" />
            at
            <Input name="hour" type="number" min={0} max={23} defaultValue={9} className="w-16" aria-label="Hour (UTC)" />
            :00 UTC
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="danger" onClick={() => setRec.mutate({ templateId: scheduling!, rule: null }, { onSuccess: () => setScheduling(null) })}>
              Stop repeating
            </Button>
            <Button variant="primary">Save schedule</Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
