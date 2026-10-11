"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/shell";
import { Button, EmptyState, IssueKey, PRIORITY_META, Select, TYPE_META } from "@/components/ui";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/validators";
import { useTRPC } from "@/trpc/react";

type Suggestion = { type: (typeof ISSUE_TYPES)[number]; priority: (typeof PRIORITIES)[number]; assigneeId: string | null; labelIds: string[]; reason: string };

export default function Triage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const list = useQuery(trpc.search.query.queryOptions({ kql: "triage = true order by created", limit: 100 }));
  const users = useQuery(trpc.user.list.queryOptions());
  const ai = useQuery(trpc.ai.status.queryOptions());
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const refresh = () => qc.invalidateQueries();
  const update = useMutation(trpc.issue.update.mutationOptions({ onSuccess: refresh }));
  const suggest = useMutation(trpc.ai.triageSuggest.mutationOptions());
  const restore = useMutation(trpc.issue.restore.mutationOptions({ onSuccess: refresh }));
  const dismiss = useMutation(
    trpc.issue.delete.mutationOptions({
      onSuccess: (row) => (refresh(), toast("Dismissed", { action: { label: "Undo", onClick: () => restore.mutate({ id: row.id }) } })),
    }),
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <h1 className="page-title">Triage</h1>
      <p className="mb-6 text-muted">New issues from email, Slack and people outside the team land here. Set the basics and accept them onto the board.</p>
      {list.data?.length === 0 && <EmptyState title="Nothing waiting">New issues from email and Slack will show up here.</EmptyState>}
      <ul className="space-y-3">
        {list.data?.map((i) => {
          const s = suggestions[i.id];
          return (
            <li key={i.id} className="card p-4">
              <div className="mb-2 flex items-start gap-2">
                <Link href={`/i/${i.key}`} className="min-w-0 flex-1 hover:underline">
                  <IssueKey k={i.key} /> <span className="font-medium">{i.title}</span>
                </Link>
                <span className="text-[12px] text-muted">{new Date(i.createdAt).toLocaleString()}</span>
              </div>
              {me.role !== "guest" && (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    update.mutate(
                      {
                        id: i.id,
                        type: f.get("type") as Suggestion["type"],
                        priority: f.get("priority") as Suggestion["priority"],
                        assigneeId: (f.get("assignee") as string) || null,
                        labelIds: s?.labelIds,
                        triage: false,
                      },
                      { onSuccess: () => toast.success(`${i.key} accepted`) },
                    );
                  }}
                  key={s ? "s" : "n"}
                >
                  <Select name="type" defaultValue={s?.type ?? i.type} className="w-28" aria-label="Type">
                    {ISSUE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_META[t].label}
                      </option>
                    ))}
                  </Select>
                  <Select name="priority" defaultValue={s?.priority ?? i.priority} className="w-32" aria-label="Priority">
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </option>
                    ))}
                  </Select>
                  <Select name="assignee" defaultValue={s?.assigneeId ?? i.assigneeId ?? ""} className="w-40" aria-label="Assignee">
                    <option value="">Unassigned</option>
                    {users.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                  {ai.data?.enabled && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={suggest.isPending}
                      onClick={() => suggest.mutate({ issueId: i.id }, { onSuccess: (r) => setSuggestions((x) => ({ ...x, [i.id]: r })) })}
                    >
                      <Sparkles size={13} /> Suggest
                    </Button>
                  )}
                  <Button variant="primary" size="sm" className="ml-auto h-8">
                    Accept
                  </Button>
                  <Button type="button" variant="danger" size="sm" className="h-8" onClick={() => dismiss.mutate({ id: i.id })}>
                    Dismiss
                  </Button>
                </form>
              )}
              {s && <p className="mt-2 text-[12px] text-muted">Suggestion: {s.reason}</p>}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
