"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/validators";
import { useTRPC } from "@/trpc/react";
import { MentionTextarea } from "./mention-textarea";
import { Button, field, Input, IssueKey, Kbd, Modal, PRIORITY_META, Select, TYPE_META } from "./ui";

type Draft = {
  title: string;
  type: (typeof ISSUE_TYPES)[number];
  priority: (typeof PRIORITIES)[number];
  assigneeId: string;
  labelIds: string[];
};
const EMPTY: Draft = { title: "", type: "task", priority: "none", assigneeId: "", labelIds: [] };

export function CreateIssueDialog({ open, onClose, defaultProjectId }: { open: boolean; onClose: () => void; defaultProjectId?: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const projects = useQuery({ ...trpc.project.list.queryOptions(), enabled: open });
  const users = useQuery({ ...trpc.user.list.queryOptions(), enabled: open });
  const ai = useQuery({ ...trpc.ai.status.queryOptions(), enabled: open });
  const [projectId, setProjectId] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [debouncedTitle, setDebouncedTitle] = useState("");

  useEffect(() => {
    if (open) setProjectId(defaultProjectId ?? projects.data?.[0]?.id ?? "");
  }, [open, defaultProjectId, projects.data]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTitle(draft.title.trim()), 350);
    return () => clearTimeout(t);
  }, [draft.title]);

  const similar = useQuery({ ...trpc.ai.similar.queryOptions({ projectId: projectId || undefined, text: debouncedTitle }), enabled: open && debouncedTitle.length > 8 });
  const templates = useQuery({ ...trpc.automation.templates.queryOptions({ projectId }), enabled: open && !!projectId });

  const reset = () => {
    setDraft(EMPTY);
    setDescription("");
    setNotes(null);
  };
  const close = () => (reset(), onClose());
  const created = (row: { key: string }) => {
    qc.invalidateQueries({ queryKey: trpc.issue.pathKey() });
    qc.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
    close();
    toast.success(`Created ${row.key}`, { action: { label: "Open", onClick: () => router.push(`/i/${row.key}`) } });
  };
  const create = useMutation(trpc.issue.create.mutationOptions({ onSuccess: created }));
  const fromTemplate = useMutation(
    trpc.automation.useTemplate.mutationOptions({
      onSuccess: (row) => created({ key: `${projects.data?.find((p) => p.id === projectId)?.key}-${row.number}` }),
    }),
  );
  const write = useMutation(
    trpc.ai.draftIssue.mutationOptions({
      onSuccess: (d) => {
        setDraft({ title: d.title, type: d.type, priority: d.priority, assigneeId: d.assigneeId ?? "", labelIds: d.labelIds });
        setDescription(d.description);
        setNotes(null);
        toast("Draft ready. Check it, then create.");
      },
    }),
  );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      projectId,
      title: draft.title,
      description,
      type: draft.type,
      priority: draft.priority,
      assigneeId: draft.assigneeId || null,
      labelIds: draft.labelIds,
      dueDate: (f.get("dueDate") as string) || null,
      estimate: f.get("estimate") ? Number(f.get("estimate")) : null,
    });
  }

  return (
    <Modal open={open} onClose={close} title="New issue">
      {notes !== null ? (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">Paste meeting notes, a bug report or a Slack thread. You’ll review the draft before anything is created.</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={10} autoFocus className={field} aria-label="Notes" placeholder="Customer says checkout fails on Safari when they apply a coupon…" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setNotes(null)}>Back</Button>
            <Button variant="primary" disabled={notes.trim().length < 3 || write.isPending || !projectId} onClick={() => write.mutate({ projectId, notes })}>
              <Sparkles size={14} /> {write.isPending ? "Writing…" : "Write the issue"}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && e.currentTarget.requestSubmit()} className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} required aria-label="Project">
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </option>
              ))}
            </Select>
            <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })} aria-label="Type">
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_META[t].label}
                </option>
              ))}
            </Select>
            <Select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Draft["priority"] })} aria-label="Priority">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
          </div>
          <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="What needs doing?" required maxLength={255} autoFocus className="h-10 text-base" aria-label="Title" />
          {!!similar.data?.length && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px]">
              <div className="mb-1 font-medium">Might already exist:</div>
              <ul className="space-y-0.5">
                {similar.data.map((s) => (
                  <li key={s.id}>
                    <Link href={`/i/${s.key}`} onClick={close} className="hover:underline">
                      <IssueKey k={s.key} /> {s.title} <span className="text-muted">· {s.statusName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <MentionTextarea value={description} onChange={setDescription} placeholder="Add details, steps to reproduce, acceptance criteria… Markdown works; type @ to mention." rows={6} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Select value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })} aria-label="Assignee">
              <option value="">Unassigned</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <Input name="dueDate" type="date" aria-label="Due date" />
            <Input name="estimate" type="number" min={0} max={1000} placeholder="Points" aria-label="Estimate in points" />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {ai.data?.enabled && (
              <Button type="button" size="sm" onClick={() => setNotes("")}>
                <Sparkles size={13} /> Write from notes
              </Button>
            )}
            {!!templates.data?.length && (
              <Select
                value=""
                onChange={(e) => e.target.value && fromTemplate.mutate({ id: e.target.value })}
                className="h-7 w-44 text-[13px]"
                aria-label="Create from template"
              >
                <option value="">From template…</option>
                {templates.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            <span className="ml-auto text-[12px] text-muted">
              <Kbd>⌘</Kbd> <Kbd>Enter</Kbd>
            </span>
            <Button variant="primary" disabled={create.isPending || !projectId}>
              Create issue
            </Button>
          </div>
          {projects.data && !projects.data.length && <p className="text-[13px] text-muted">Create a project first, then add issues to it.</p>}
        </form>
      )}
    </Modal>
  );
}
