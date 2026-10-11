"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ThumbsUp, X } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useShell } from "@/components/shell";
import { Button, cn, IssueKey, Select } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

const COLUMNS = [
  ["well", "Went well"],
  ["improve", "To improve"],
  ["action", "Actions"],
] as const;

export default function Retro({ params }: { params: Promise<{ key: string }> }) {
  const key = use(params).key.toUpperCase();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const project = useQuery(trpc.project.byKey.queryOptions({ key }));
  const sprints = useQuery({ ...trpc.sprint.list.queryOptions({ projectId: project.data?.id ?? "00000000-0000-0000-0000-000000000000", includeClosed: true }), enabled: !!project.data });
  const [sprintId, setSprintId] = useState("");
  useEffect(() => {
    if (!sprintId && sprints.data?.length) setSprintId((sprints.data.find((s) => s.sprint.state === "closed") ?? sprints.data[0]).sprint.id);
  }, [sprints.data, sprintId]);
  const items = useQuery({ ...trpc.retro.items.queryOptions({ sprintId }), enabled: !!sprintId });
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.retro.pathKey() });
  const add = useMutation(trpc.retro.add.mutationOptions({ onSuccess: refresh }));
  const vote = useMutation(trpc.retro.vote.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.retro.remove.mutationOptions({ onSuccess: refresh }));
  const toIssue = useMutation(trpc.retro.toIssue.mutationOptions({ onSuccess: refresh }));
  const readOnly = me.role === "guest";

  return (
    <main className="px-4 py-6 md:px-8">
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <Link href={`/p/${key}`} className="font-mono text-[12px] text-muted hover:text-ink">
            {key}
          </Link>
          <h1 className="page-title">Retrospective</h1>
        </div>
        <Select value={sprintId} onChange={(e) => setSprintId(e.target.value)} className="w-56" aria-label="Sprint">
          {sprints.data?.map(({ sprint: s }) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.state})
            </option>
          ))}
        </Select>
      </div>
      {!sprints.data?.length && <p className="text-muted">Create a sprint first. Retros belong to a sprint.</p>}
      {sprintId && (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map(([col, title]) => (
            <section key={col} className="rounded-lg bg-sunken p-3">
              <h2 className="mb-2 font-semibold">{title}</h2>
              <ul className="mb-3 space-y-2">
                {items.data
                  ?.filter((i) => i.item.column === col)
                  .sort((a, b) => b.item.votes.length - a.item.votes.length)
                  .map(({ item, author, issueKey }) => (
                    <li key={item.id} className="rounded-md border border-line bg-surface p-2.5">
                      <p className="mb-1.5 whitespace-pre-wrap">{item.body}</p>
                      <div className="flex items-center gap-2 text-[12px] text-muted">
                        <span>{author}</span>
                        <button
                          disabled={readOnly}
                          aria-pressed={item.votes.includes(me.id)}
                          onClick={() => vote.mutate({ id: item.id })}
                          className={cn("ml-auto flex items-center gap-1 rounded px-1.5", item.votes.includes(me.id) ? "bg-accent-soft text-accent" : "hover:bg-sunken")}
                        >
                          <ThumbsUp size={12} /> {item.votes.length}
                        </button>
                        {col === "action" &&
                          (issueKey ? (
                            <Link href={`/i/${issueKey}`}>
                              <IssueKey k={issueKey} />
                            </Link>
                          ) : (
                            !readOnly && (
                              <button className="text-accent hover:underline" onClick={() => toIssue.mutate({ id: item.id })}>
                                Make issue
                              </button>
                            )
                          ))}
                        {!readOnly && (item.authorId === me.id || me.role === "admin") && (
                          <button aria-label="Remove note" className="hover:text-danger" onClick={() => remove.mutate({ id: item.id })}>
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
              {!readOnly && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const body = String(new FormData(e.currentTarget).get("body"));
                    add.mutate({ sprintId, column: col, body });
                    e.currentTarget.reset();
                  }}
                  className="flex gap-1.5"
                >
                  <input name="body" required maxLength={1000} placeholder="Add a note…" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5" aria-label={`Add to ${title}`} />
                  <Button size="sm" className="h-8">
                    Add
                  </Button>
                </form>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
