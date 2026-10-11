"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Clock, Paperclip, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/react";
import { RichText } from "./mention-textarea";
import { Button, cn, Input, IssueKey, Select } from "./ui";

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

/** "1h 30m", "90m", "1.5h", "2h" → minutes */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  let total = 0;
  let matched = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|m)/g)) {
    matched = true;
    total += m[2] === "h" ? Number(m[1]) * 60 : Number(m[1]);
  }
  return matched && total > 0 ? Math.round(total) : null;
}

export function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[12px] text-muted">{label}</div>
      {children}
    </div>
  );
}

export function PlanningFields({
  projectId,
  sprintId,
  releaseId,
  readOnly,
  kanban,
  onChange,
}: {
  projectId: string;
  sprintId: string | null;
  releaseId: string | null;
  readOnly: boolean;
  kanban?: boolean;
  onChange: (p: { sprintId?: string | null; releaseId?: string | null }) => void;
}) {
  const trpc = useTRPC();
  const sprints = useQuery({ ...trpc.sprint.list.queryOptions({ projectId }), enabled: !kanban });
  const releases = useQuery(trpc.release.list.queryOptions({ projectId }));
  return (
    <>
      {!kanban && (
      <SidebarField label="Sprint">
        <Select value={sprintId ?? ""} disabled={readOnly} onChange={(e) => onChange({ sprintId: e.target.value || null })} aria-label="Sprint">
          <option value="">Backlog</option>
          {sprints.data?.map(({ sprint: s }) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.state === "active" ? " (active)" : ""}
            </option>
          ))}
        </Select>
      </SidebarField>
      )}
      <SidebarField label="Release">
        <Select value={releaseId ?? ""} disabled={readOnly} onChange={(e) => onChange({ releaseId: e.target.value || null })} aria-label="Release">
          <option value="">None</option>
          {releases.data
            ?.filter(({ release: r }) => !r.releasedAt || r.id === releaseId)
            .map(({ release: r }) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </Select>
      </SidebarField>
    </>
  );
}

export function WatchButton({ issueId }: { issueId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.extras.watching.queryOptions({ issueId }));
  const set = useMutation(trpc.extras.setWatching.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.extras.watching.queryKey({ issueId }) }) }));
  if (!q.data) return null;
  return (
    <Button size="sm" aria-pressed={q.data.me} onClick={() => set.mutate({ issueId, watching: !q.data.me })}>
      {q.data.me ? <BellOff size={14} /> : <Bell size={14} />}
      {q.data.me ? "Stop watching" : "Watch"} · {q.data.count}
    </Button>
  );
}

const LINK_TYPES = [
  ["blocks", "blocks"],
  ["blocked_by", "is blocked by"],
  ["relates", "relates to"],
  ["duplicates", "duplicates"],
  ["clones", "clones"],
] as const;

export function Links({ issueId, readOnly }: { issueId: string; readOnly: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.extras.links.queryOptions({ issueId }));
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.extras.links.queryKey({ issueId }) });
  const add = useMutation(trpc.extras.addLink.mutationOptions({ onSuccess: () => (refresh(), setAdding(false)) }));
  const remove = useMutation(trpc.extras.removeLink.mutationOptions({ onSuccess: refresh }));
  if (!q.data?.length && readOnly) return null;
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold">Linked issues</h2>
        {!readOnly && !adding && (
          <button className="text-[13px] text-accent hover:underline" onClick={() => setAdding(true)}>
            Link an issue
          </button>
        )}
      </div>
      {adding && (
        <form
          className="mb-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            add.mutate({ issueId, type: f.get("type") as (typeof LINK_TYPES)[number][0], target: String(f.get("target")).trim().toUpperCase() as never });
          }}
        >
          <Select name="type" className="w-40" aria-label="Link type">
            {LINK_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Input name="target" placeholder="KEY-123" required pattern="[A-Za-z][A-Za-z0-9]*-\d+" className="w-32 font-mono" aria-label="Issue key" />
          <Button variant="primary" size="sm" className="h-8">
            Link
          </Button>
          <Button size="sm" className="h-8" type="button" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      )}
      <ul className="divide-y divide-line rounded-md border border-line bg-surface empty:hidden">
        {q.data?.map((l) => (
          <li key={`${l.id}-${l.label}`} className="flex items-center gap-2 px-3 py-2">
            <span className="w-28 shrink-0 text-[12px] text-muted">{l.label}</span>
            <Link href={`/i/${l.key}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
              <IssueKey k={l.key} />
              <span className={cn("truncate", l.statusCategory === "done" && "text-muted line-through")}>{l.title}</span>
            </Link>
            <span className="text-[12px] text-muted">{l.statusName}</span>
            {!readOnly && (
              <button aria-label="Remove link" className="text-muted hover:text-danger" onClick={() => remove.mutate({ id: l.id })}>
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CustomFields({ projectId, issueId, readOnly }: { projectId: string; issueId: string; readOnly: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const fields = useQuery(trpc.extras.fields.queryOptions({ projectId }));
  const values = useQuery(trpc.extras.values.queryOptions({ issueId }));
  const set = useMutation(trpc.extras.setValue.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.extras.values.queryKey({ issueId }) }) }));
  if (!fields.data?.length) return null;
  const valueOf = (fid: string) => values.data?.find((v) => v.fieldId === fid)?.value ?? "";
  return (
    <>
      {fields.data.map((f) => (
        <SidebarField key={f.id} label={f.name}>
          {f.type === "select" ? (
            <Select value={String(valueOf(f.id))} disabled={readOnly} onChange={(e) => set.mutate({ issueId, fieldId: f.id, value: e.target.value || null })} aria-label={f.name}>
              <option value="">—</option>
              {f.options?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          ) : (
            <Input
              key={`${f.id}-${valueOf(f.id)}`}
              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
              defaultValue={String(valueOf(f.id))}
              disabled={readOnly}
              aria-label={f.name}
              onBlur={(e) => {
                const raw = e.target.value;
                if (raw === String(valueOf(f.id))) return;
                set.mutate({ issueId, fieldId: f.id, value: raw === "" ? null : f.type === "number" ? Number(raw) : raw });
              }}
            />
          )}
        </SidebarField>
      ))}
    </>
  );
}

export function TimeTracking({ issueId, estimate, readOnly }: { issueId: string; estimate: number | null; readOnly: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const logs = useQuery(trpc.time.forIssue.queryOptions({ issueId }));
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.time.forIssue.queryKey({ issueId }) });
  const log = useMutation(trpc.time.log.mutationOptions({ onSuccess: () => (refresh(), setOpen(false), toast.success("Time logged")) }));
  const remove = useMutation(trpc.time.remove.mutationOptions({ onSuccess: refresh }));
  const total = logs.data?.reduce((n, l) => n + l.minutes, 0) ?? 0;
  return (
    <SidebarField label="Time logged">
      <div className="flex items-center gap-2">
        <Clock size={14} className="text-muted" aria-hidden />
        <span>{total ? fmtMinutes(total) : "None yet"}</span>
        {estimate != null && <span className="text-[12px] text-muted">· {estimate} pts estimated</span>}
        {!readOnly && (
          <button className="ml-auto text-[12px] text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
            Log time
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-2 space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const minutes = parseDuration(String(f.get("d")));
            if (!minutes) return toast.error("Enter time like 1h 30m or 45m.");
            log.mutate({ issueId, minutes, note: String(f.get("note") || "") || undefined, day: String(f.get("day")) || undefined });
          }}
        >
          <div className="flex gap-1.5">
            <Input name="d" placeholder="1h 30m" required aria-label="Duration" className="w-24" autoFocus />
            <Input name="day" type="date" defaultValue={new Date().toISOString().slice(0, 10)} aria-label="Day" />
          </div>
          <Input name="note" placeholder="What did you do? (optional)" maxLength={500} aria-label="Note" />
          <Button size="sm" variant="primary" disabled={log.isPending}>
            Save
          </Button>
        </form>
      )}
      {!!logs.data?.length && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[12px] text-muted hover:text-ink">{logs.data.length} entries</summary>
          <ul className="mt-1 space-y-1 text-[12px]">
            {logs.data.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className="text-muted">{l.day}</span>
                <span>{l.userName}</span>
                <span className="font-medium">{fmtMinutes(l.minutes)}</span>
                {l.note && <span className="truncate text-muted">{l.note}</span>}
                {!readOnly && (
                  <button className="ml-auto text-muted hover:text-danger" aria-label="Remove entry" onClick={() => remove.mutate({ id: l.id })}>
                    <X size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </SidebarField>
  );
}

export function Attachments({ issueId, readOnly }: { issueId: string; readOnly: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const list = useQuery(trpc.extras.attachments.queryOptions({ issueId }));
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const createUpload = useMutation(trpc.extras.createUpload.mutationOptions());
  const confirm = useMutation(trpc.extras.confirmUpload.mutationOptions());
  const remove = useMutation(
    trpc.extras.deleteAttachment.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.extras.attachments.queryKey({ issueId }) }) }),
  );

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      setBusy((n) => n + 1);
      try {
        const u = await createUpload.mutateAsync({ issueId, name: file.name, mime: file.type || "application/octet-stream", size: file.size });
        const res = await fetch(u.url, { method: "PUT", headers: u.headers, body: file });
        if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
        await confirm.mutateAsync({ id: u.id });
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    qc.invalidateQueries({ queryKey: trpc.extras.attachments.queryKey({ issueId }) });
    qc.invalidateQueries({ queryKey: trpc.issue.activity.queryKey({ issueId }) });
  }

  async function open(id: string) {
    const url = await qc.fetchQuery(trpc.extras.attachmentUrl.queryOptions({ id }));
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (readOnly && !list.data?.length) return null;
  return (
    <section
      className={cn("mb-8 rounded-lg", dragOver && "outline-2 outline-dashed outline-accent")}
      onDragOver={(e) => {
        if (readOnly || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (readOnly || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold">Attachments</h2>
        {!readOnly && (
          <>
            <button className="text-[13px] text-accent hover:underline" onClick={() => input.current?.click()}>
              Add files
            </button>
            <span className="text-[12px] text-muted">or drop them here</span>
            <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          </>
        )}
        {busy > 0 && <span className="text-[12px] text-muted">Uploading {busy}…</span>}
      </div>
      <ul className="flex flex-wrap gap-2 empty:hidden">
        {list.data?.map((a) => (
          <li key={a.id} className="flex max-w-64 items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
            <Paperclip size={14} className="shrink-0 text-muted" aria-hidden />
            <button className="truncate text-left hover:underline" onClick={() => open(a.id)} title={a.name}>
              {a.name}
            </button>
            <span className="shrink-0 text-[11px] text-muted">{a.size > 1e6 ? `${(a.size / 1e6).toFixed(1)} MB` : `${Math.ceil(a.size / 1e3)} KB`}</span>
            {!readOnly && (
              <button aria-label={`Delete ${a.name}`} className="text-muted hover:text-danger" onClick={() => remove.mutate({ id: a.id })}>
                <X size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}


export function GithubLinks({ issueId }: { issueId: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.extras.github.queryOptions({ issueId }));
  if (!q.data?.length) return null;
  const label = { pr: "Pull request", commit: "Commit", branch: "Branch" } as const;
  return (
    <section className="mb-8">
      <h2 className="mb-2 font-semibold">Development</h2>
      <ul className="divide-y divide-line rounded-md border border-line bg-surface">
        {q.data.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
            <span className="w-24 shrink-0 text-[12px] text-muted">{label[l.kind]}</span>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline">
              <span className="font-mono text-[12px] text-muted">
                {l.repo}
                {l.kind === "pr" ? `#${l.ref}` : l.kind === "commit" ? `@${l.ref.slice(0, 7)}` : `:${l.ref}`}
              </span>{" "}
              {l.title}
            </a>
            {l.state && (
              <span className={cn("rounded-full px-2 text-[11px] font-medium", l.state === "merged" ? "bg-violet-500/15 text-violet-600 dark:text-violet-300" : l.state === "open" ? "bg-accent-soft text-accent" : "bg-sunken text-muted")}>
                {l.state}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Sla = Partial<Record<"urgent" | "high" | "medium" | "low", { responseHours: number; resolveHours: number }>> | null;

/** Countdown to the SLA targets for this issue's priority. */
export function SlaBadge({ sla, priority, createdAt, firstResponseAt, resolved }: { sla: Sla; priority: string; createdAt: Date; firstResponseAt: Date | null; resolved: boolean }) {
  const t = sla?.[priority as "urgent"];
  if (!t || resolved) return null;
  const due = (hours: number) => new Date(createdAt).getTime() + hours * 3_600_000 - Date.now();
  const fmt = (ms: number) => {
    const h = Math.abs(ms) / 3_600_000;
    const s = h >= 48 ? `${Math.round(h / 24)}d` : h >= 1 ? `${Math.round(h)}h` : `${Math.round(h * 60)}m`;
    return ms < 0 ? `${s} over` : `${s} left`;
  };
  const parts = [
    !firstResponseAt && t.responseHours ? { label: "Response", ms: due(t.responseHours) } : null,
    t.resolveHours ? { label: "Resolve", ms: due(t.resolveHours) } : null,
  ].filter((x): x is { label: string; ms: number } => !!x);
  if (!parts.length) return null;
  return (
    <SidebarField label="SLA">
      <div className="flex flex-wrap gap-1.5">
        {parts.map((p) => (
          <span key={p.label} className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", p.ms < 0 ? "bg-danger/15 text-danger" : p.ms < 3_600_000 * 4 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-sunken text-muted")}>
            {p.label}: {fmt(p.ms)}
          </span>
        ))}
      </div>
    </SidebarField>
  );
}

export function AiThreadSummary({ issueId }: { issueId: string }) {
  const trpc = useTRPC();
  const ai = useQuery(trpc.ai.status.queryOptions());
  const sum = useMutation(trpc.ai.summarize.mutationOptions());
  if (!ai.data?.enabled) return null;
  return (
    <div className="mb-3">
      <Button size="sm" disabled={sum.isPending} onClick={() => sum.mutate({ issueId })}>
        <Sparkles size={13} /> {sum.isPending ? "Summarizing…" : "Summarize discussion"}
      </Button>
      {sum.data && (
        <div className="mt-2 rounded-md border border-line bg-sunken/50 p-3 text-[13px]">
          <div className="mb-1 text-[12px] font-medium text-muted">TL;DR</div>
          <RichText body={sum.data} />
        </div>
      )}
    </div>
  );
}

export function SplitEpic({ issueId, projectId }: { issueId: string; projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ai = useQuery(trpc.ai.status.queryOptions());
  const split = useMutation(trpc.ai.splitEpic.mutationOptions());
  const create = useMutation(trpc.issue.create.mutationOptions());
  const [picked, setPicked] = useState<Set<number>>(new Set());
  if (!ai.data?.enabled) return null;
  async function createPicked() {
    const stories = split.data!.filter((_, i) => picked.has(i));
    for (const s of stories) await create.mutateAsync({ projectId, parentId: issueId, title: s.title, description: s.description, estimate: s.estimate, type: "story", priority: "none" });
    qc.invalidateQueries({ queryKey: trpc.issue.pathKey() });
    split.reset();
    toast.success(`Created ${stories.length} stories`);
  }
  return (
    <div className="mb-3">
      {!split.data ? (
        <Button size="sm" disabled={split.isPending} onClick={() => split.mutate({ issueId }, { onSuccess: (r) => setPicked(new Set(r.map((_, i) => i))) })}>
          <Sparkles size={13} /> {split.isPending ? "Planning…" : "Suggest stories"}
        </Button>
      ) : (
        <div className="rounded-md border border-line bg-surface p-3">
          <ul className="mb-2 space-y-1.5">
            {split.data.map((s, i) => (
              <li key={i} className="flex gap-2 text-[13px]">
                <input type="checkbox" checked={picked.has(i)} onChange={() => setPicked((p) => (p.has(i) ? new Set([...p].filter((x) => x !== i)) : new Set([...p, i])))} aria-label={s.title} />
                <span className="flex-1">
                  <span className="font-medium">{s.title}</span> <span className="text-muted">· {s.estimate} pts</span>
                  <span className="block text-[12px] text-muted">{s.description}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={!picked.size || create.isPending} onClick={createPicked}>
              Create {picked.size} stories
            </Button>
            <Button size="sm" onClick={() => split.reset()}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
