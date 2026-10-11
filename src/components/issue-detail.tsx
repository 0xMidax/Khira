"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Link2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/validators";
import { useTRPC } from "@/trpc/react";
import { AiThreadSummary, Attachments, CustomFields, GithubLinks, Links, PlanningFields, SlaBadge, SplitEpic, TimeTracking, WatchButton } from "./issue-extras";
import { MentionTextarea, RichText } from "./mention-textarea";
import { useShell } from "./shell";
import { Avatar, Button, cn, field, Input, IssueKey, PRIORITY_META, Select, STATUS_DOT, TYPE_META, TypeIcon } from "./ui";

const ago = (d: Date) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
};

export function IssueDetail({ issueKey, onDeleted }: { issueKey: string; onDeleted?: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const { me } = useShell();
  const readOnly = me.role === "guest";
  const q = useQuery(trpc.issue.byKey.queryOptions({ key: issueKey }));
  const projectKey = issueKey.split("-")[0].toUpperCase();
  const project = useQuery(trpc.project.byKey.queryOptions({ key: projectKey }));
  const users = useQuery(trpc.user.list.queryOptions());

  const refresh = () => {
    qc.invalidateQueries({ queryKey: trpc.issue.pathKey() });
    qc.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
  };
  const update = useMutation(trpc.issue.update.mutationOptions({ onSuccess: refresh }));
  const del = useMutation(
    trpc.issue.delete.mutationOptions({
      onSuccess: (row) => {
        refresh();
        toast(`Deleted ${issueKey}`, {
          action: { label: "Undo", onClick: () => restore.mutate({ id: row.id }) },
        });
        if (onDeleted) onDeleted();
        else router.push(`/p/${projectKey}`);
      },
    }),
  );
  const restore = useMutation(trpc.issue.restore.mutationOptions({ onSuccess: refresh }));

  if (q.isError) return <p className="p-6 text-muted">{q.error.message === "NOT_FOUND" ? `${issueKey} doesn’t exist or was deleted.` : q.error.message}</p>;
  if (!q.data) return <div className="p-6 text-muted">Loading {issueKey}…</div>;
  const { issue, status } = q.data;
  // Every field change offers a one-click undo (restores the previous values of exactly the fields changed).
  const set = (patch: Omit<Parameters<typeof update.mutate>[0], "id">) => {
    const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, k === "labelIds" ? q.data!.labels.map((l) => l.id) : issue[k as keyof typeof issue]]));
    update.mutate(
      { id: issue.id, ...patch },
      { onSuccess: () => toast("Updated", { action: { label: "Undo", onClick: () => update.mutate({ id: issue.id, ...(prev as typeof patch) }) } }) },
    );
  };
  const branch = `${issueKey.toLowerCase()}-${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;

  return (
    <div className="grid gap-8 p-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:p-8">
      {!readOnly && <IssueShortcuts onAssignMe={() => issue.assigneeId !== me.id && set({ assigneeId: me.id })} />}
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <Link href={`/p/${projectKey}`} className="hover:text-ink">
            {q.data.projectName}
          </Link>
          <span aria-hidden>/</span>
          {q.data.parent && (
            <>
              <Link href={`/i/${q.data.parent.key}`} className="hover:text-ink">
                <IssueKey k={q.data.parent.key} />
              </Link>
              <span aria-hidden>/</span>
            </>
          )}
          <TypeIcon type={issue.type} />
          <IssueKey k={issueKey} />
        </div>

        {issue.triage && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px]">
            <span className="flex-1">This came in from {issue.source} and is waiting in triage.</span>
            {!readOnly && (
              <Button size="sm" variant="primary" onClick={() => set({ triage: false })}>
                Accept
              </Button>
            )}
          </div>
        )}
        <Title value={issue.title} readOnly={readOnly} onSave={(title) => set({ title })} />
        <Description value={issue.description} readOnly={readOnly} onSave={(description) => set({ description })} />

        <Attachments issueId={issue.id} readOnly={readOnly} />
        {issue.type === "epic" && !readOnly && <SplitEpic issueId={issue.id} projectId={issue.projectId} />}
        <Subtasks parent={issue} items={q.data.children} readOnly={readOnly} />
        <Links issueId={issue.id} readOnly={readOnly} />
        <GithubLinks issueId={issue.id} />
        <AiThreadSummary issueId={issue.id} />
        <Comments issueId={issue.id} readOnly={readOnly} />
      </div>

      <aside className="space-y-4 text-[13px] lg:border-l lg:border-line lg:pl-6">
        <Field label="Status">
          <div className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOT[status.color])} aria-hidden />
            <Select value={issue.statusId} disabled={readOnly} onChange={(e) => set({ statusId: e.target.value })} aria-label="Status">
              {project.data?.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <SlaBadge sla={q.data.sla} priority={issue.priority} createdAt={issue.createdAt} firstResponseAt={issue.firstResponseAt} resolved={status.category === "done"} />
        <Field label="Assignee">
          <div className="flex items-center gap-2">
            <Avatar name={q.data.assignee?.name} image={q.data.assignee?.image} />
            <Select value={issue.assigneeId ?? ""} disabled={readOnly} onChange={(e) => set({ assigneeId: e.target.value || null })} aria-label="Assignee">
              <option value="">Unassigned</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          {!readOnly && issue.assigneeId !== me.id && (
            <button className="mt-1 text-[12px] text-accent hover:underline" onClick={() => set({ assigneeId: me.id })}>
              Assign to me
            </button>
          )}
        </Field>
        <Field label="Priority">
          <Select value={issue.priority} disabled={readOnly} onChange={(e) => set({ priority: e.target.value as (typeof PRIORITIES)[number] })} aria-label="Priority">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={issue.type} disabled={readOnly} onChange={(e) => set({ type: e.target.value as (typeof ISSUE_TYPES)[number] })} aria-label="Type">
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_META[t].label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estimate">
            <Input
              type="number"
              min={0}
              max={1000}
              defaultValue={issue.estimate ?? ""}
              key={`est-${issue.estimate}`}
              disabled={readOnly}
              aria-label="Estimate in points"
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                if (v !== issue.estimate) set({ estimate: v });
              }}
            />
          </Field>
          <Field label="Due">
            <Input type="date" value={issue.dueDate ?? ""} disabled={readOnly} aria-label="Due date" onChange={(e) => set({ dueDate: e.target.value || null })} />
          </Field>
        </div>
        <PlanningFields projectId={issue.projectId} sprintId={issue.sprintId} releaseId={issue.releaseId} readOnly={readOnly} kanban={project.data?.settings.method === "kanban"} onChange={set} />
        <Labels issueId={issue.id} projectId={issue.projectId} selected={q.data.labels.map((l) => l.id)} all={project.data?.labels ?? []} readOnly={readOnly} onChange={(labelIds) => set({ labelIds })} />
        <CustomFields projectId={issue.projectId} issueId={issue.id} readOnly={readOnly} />
        <TimeTracking issueId={issue.id} estimate={issue.estimate} readOnly={readOnly} />
        <Field label="Reporter">
          <span className="flex items-center gap-2">
            <Avatar name={q.data.reporter.name} image={q.data.reporter.image} /> {q.data.reporter.name}
          </span>
        </Field>
        <p className="text-[12px] text-muted">
          Created {ago(issue.createdAt)} · Updated {ago(issue.updatedAt)}
          {issue.resolvedAt && ` · Resolved ${ago(issue.resolvedAt)}`}
        </p>
        <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
          <WatchButton issueId={issue.id} />
          <Button size="sm" onClick={() => navigator.clipboard.writeText(`${location.origin}/i/${issueKey}`).then(() => toast.success("Link copied"))}>
            <Link2 size={14} /> Copy link
          </Button>
          <Button size="sm" onClick={() => navigator.clipboard.writeText(branch).then(() => toast.success(`Copied ${branch}`))}>
            <GitBranch size={14} /> Branch name
          </Button>
          {!readOnly && (
            <Button size="sm" variant="danger" onClick={() => del.mutate({ id: issue.id })}>
              <Trash2 size={14} /> Delete
            </Button>
          )}
        </div>
        <Activity issueId={issue.id} />
      </aside>
    </div>
  );
}

function IssueShortcuts({ onAssignMe }: { onAssignMe: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) || document.querySelector("dialog[open]")) return;
      if (e.key === "a") onAssignMe();
      else if (e.key === "s") (document.querySelector('select[aria-label="Status"]') as HTMLSelectElement | null)?.focus();
      else if (e.key === "m") (document.querySelector('textarea[aria-label="New comment"]') as HTMLTextAreaElement | null)?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAssignMe]);
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[12px] text-muted">{label}</div>
      {children}
    </div>
  );
}

function Title({ value, onSave, readOnly }: { value: string; onSave: (v: string) => void; readOnly: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      value={v}
      readOnly={readOnly}
      rows={1}
      aria-label="Title"
      onChange={(e) => setV(e.target.value.replace(/\n/g, ""))}
      onBlur={() => v.trim() && v !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
      className="mb-4 w-full resize-none rounded-md bg-transparent text-2xl leading-snug font-semibold [field-sizing:content] hover:bg-sunken/60 focus:bg-surface focus:outline-none"
    />
  );
}

function Description({ value, onSave, readOnly }: { value: string; onSave: (v: string) => void; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (editing)
    return (
      <div className="mb-8 space-y-2">
        <MentionTextarea value={v} onChange={setV} rows={8} autoFocus aria-label="Description" />
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => (onSave(v), setEditing(false))}>
            Save
          </Button>
          <Button size="sm" onClick={() => (setV(value), setEditing(false))}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <div
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? undefined : 0}
      onClick={() => !readOnly && setEditing(true)}
      onKeyDown={(e) => !readOnly && e.key === "Enter" && setEditing(true)}
      className={cn("mb-8 min-h-16 rounded-md p-2 -mx-2", !readOnly && "cursor-text hover:bg-sunken/60")}
    >
      {value ? <RichText body={value} /> : <span className="text-muted">{readOnly ? "No description." : "Add a description…"}</span>}
    </div>
  );
}

function Labels(props: { issueId: string; projectId: string; selected: string[]; all: { id: string; name: string }[]; readOnly: boolean; onChange: (ids: string[]) => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const createLabel = useMutation(
    trpc.project.createLabel.mutationOptions({
      onSuccess: (l) => {
        qc.invalidateQueries({ queryKey: trpc.project.byKey.pathKey() });
        if (!props.selected.includes(l.id)) props.onChange([...props.selected, l.id]);
        setName("");
      },
    }),
  );
  const toggle = (id: string) => props.onChange(props.selected.includes(id) ? props.selected.filter((x) => x !== id) : [...props.selected, id]);
  return (
    <Field label="Labels">
      <div className="flex flex-wrap gap-1">
        {props.all.map((l) => {
          const on = props.selected.includes(l.id);
          return (
            <button
              key={l.id}
              disabled={props.readOnly}
              aria-pressed={on}
              onClick={() => toggle(l.id)}
              className={cn("rounded-full border px-2 py-0.5 text-[12px]", on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink", props.readOnly && !on && "hidden")}
            >
              {l.name}
            </button>
          );
        })}
      </div>
      {!props.readOnly && (
        <form
          className="mt-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createLabel.mutate({ projectId: props.projectId, name: name.trim() });
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add label…" maxLength={40} className={cn(field, "h-7 text-[12px]")} aria-label="New label" />
        </form>
      )}
    </Field>
  );
}

function Subtasks({ parent, items, readOnly }: { parent: { id: string; projectId: string; type: string }; items: { id: string; key: string; title: string; statusName: string; statusCategory: string; assigneeName: string | null; assigneeImage: string | null }[]; readOnly: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const create = useMutation(
    trpc.issue.create.mutationOptions({
      onSuccess: () => {
        setTitle("");
        qc.invalidateQueries({ queryKey: trpc.issue.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
      },
    }),
  );
  const done = items.filter((i) => i.statusCategory === "done").length;
  const childType = parent.type === "epic" ? "story" : "subtask";
  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        {parent.type === "epic" ? "Issues in this epic" : "Subtasks"}
        {items.length > 0 && (
          <span className="text-[12px] font-normal text-muted">
            {done}/{items.length} done
          </span>
        )}
      </h2>
      {items.length > 0 && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <div className="h-full bg-accent" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <ul className="divide-y divide-line rounded-md border border-line bg-surface empty:hidden">
        {items.map((c) => (
          <li key={c.id}>
            <Link href={`/i/${c.key}`} className="flex items-center gap-2 px-3 py-2 hover:bg-sunken">
              <IssueKey k={c.key} />
              <span className={cn("flex-1 truncate", c.statusCategory === "done" && "text-muted line-through")}>{c.title}</span>
              <span className="text-[12px] text-muted">{c.statusName}</span>
              <Avatar name={c.assigneeName} image={c.assigneeImage} size={18} />
            </Link>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate({ projectId: parent.projectId, parentId: parent.id, title: title.trim(), type: childType, priority: "none" });
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Add a ${childType}…`} aria-label={`New ${childType}`} />
        </form>
      )}
    </section>
  );
}

const EMOJI = ["👍", "🎉", "❤️", "👀", "🚀", "😕"] as const;

function Comments({ issueId, readOnly }: { issueId: string; readOnly: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const list = useQuery(trpc.comment.list.queryOptions({ issueId }));
  const reactions = useQuery(trpc.extras.reactions.queryOptions({ issueId }));
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: trpc.comment.list.queryKey({ issueId }) });
    qc.invalidateQueries({ queryKey: trpc.issue.activity.queryKey({ issueId }) });
  };
  const create = useMutation(trpc.comment.create.mutationOptions({ onSuccess: () => (setBody(""), setReply(""), setReplyTo(null), invalidate()) }));
  const remove = useMutation(trpc.comment.delete.mutationOptions({ onSuccess: invalidate }));
  const react = useMutation(trpc.extras.react.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.extras.reactions.queryKey({ issueId }) }) }));

  const all = list.data ?? [];
  const roots = all.filter((c) => !c.parentId || !all.some((p) => p.id === c.parentId));
  const repliesOf = (id: string) => all.filter((c) => c.parentId === id);

  const one = (c: (typeof all)[number], nested = false) => {
    const rs = reactions.data?.filter((r) => r.commentId === c.id) ?? [];
    const counts = EMOJI.map((e) => ({ e, n: rs.filter((r) => r.emoji === e).length, mine: rs.some((r) => r.emoji === e && r.userId === me.id) })).filter((x) => x.n);
    return (
      <div className={cn("flex gap-3", nested && "mt-3")}>
        <Avatar name={c.authorName} image={c.authorImage} size={nested ? 22 : 26} />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-baseline gap-2 text-[13px]">
            <span className="font-medium">{c.authorName}</span>
            <span className="text-muted">
              {ago(c.createdAt)}
              {c.editedAt && " (edited)"}
            </span>
            {(c.authorId === me.id || me.role === "admin") && !readOnly && (
              <button className="ml-auto text-[12px] text-muted hover:text-danger" onClick={() => remove.mutate({ id: c.id })}>
                Delete
              </button>
            )}
          </div>
          <RichText body={c.body} />
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {counts.map(({ e, n, mine }) => (
              <button
                key={e}
                aria-pressed={mine}
                onClick={() => react.mutate({ commentId: c.id, emoji: e })}
                className={cn("rounded-full border px-1.5 text-[12px]", mine ? "border-accent bg-accent-soft" : "border-line hover:bg-sunken")}
              >
                {e} {n}
              </button>
            ))}
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-full px-1.5 text-[12px] text-muted hover:bg-sunken" aria-label="Add reaction">
                ☺+
              </summary>
              <div className="absolute z-10 mt-1 flex gap-0.5 rounded-md border border-line bg-surface p-1 shadow-md">
                {EMOJI.map((e) => (
                  <button key={e} className="rounded px-1 hover:bg-sunken" onClick={(ev) => (react.mutate({ commentId: c.id, emoji: e }), ev.currentTarget.closest("details")?.removeAttribute("open"))}>
                    {e}
                  </button>
                ))}
              </div>
            </details>
            {!nested && !readOnly && (
              <button className="text-[12px] text-muted hover:text-ink" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                Reply
              </button>
            )}
          </div>
          {!nested && repliesOf(c.id).map((r) => <div key={r.id}>{one(r, true)}</div>)}
          {replyTo === c.id && (
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (reply.trim()) create.mutate({ issueId, body: reply, parentId: c.id });
              }}
            >
              <MentionTextarea value={reply} onChange={setReply} rows={2} autoFocus placeholder="Write a reply…" aria-label="Reply" />
              <Button variant="primary" size="sm" disabled={!reply.trim() || create.isPending}>
                Reply
              </Button>
            </form>
          )}
        </div>
      </div>
    );
  };

  return (
    <section>
      <h2 className="mb-3 font-semibold">Comments</h2>
      <ol className="mb-4 space-y-5">
        {roots.map((c) => (
          <li key={c.id}>{one(c)}</li>
        ))}
      </ol>
      {!readOnly && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) create.mutate({ issueId, body });
          }}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && e.currentTarget.requestSubmit()}
        >
          <MentionTextarea value={body} onChange={setBody} rows={3} placeholder="Write a comment. Markdown works; type @ to mention someone." aria-label="New comment" />
          <Button variant="primary" size="sm" disabled={!body.trim() || create.isPending}>
            Comment
          </Button>
        </form>
      )}
    </section>
  );
}

const FIELD_LABEL: Record<string, string> = {
  sprintId: "sprint",
  releaseId: "release",
  statusId: "status",
  assigneeId: "assignee",
  parentId: "parent",
  dueDate: "due date",
  startDate: "start date",
};

function Activity({ issueId }: { issueId: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.issue.activity.queryOptions({ issueId }));
  return (
    <details className="border-t border-line pt-3">
      <summary className="cursor-pointer text-[12px] text-muted hover:text-ink">History ({q.data?.length ?? 0})</summary>
      <ol className="mt-2 space-y-1.5 text-[12px] text-muted">
        {q.data?.map((a) => (
          <li key={a.id}>
            <span className="text-ink">{a.actorName}</span>{" "}
            {a.verb === "updated" ? `changed ${Object.keys(a.diff ?? {}).map((k) => FIELD_LABEL[k] ?? k).join(", ")}` : a.verb} · {ago(a.createdAt)}
          </li>
        ))}
      </ol>
    </details>
  );
}
