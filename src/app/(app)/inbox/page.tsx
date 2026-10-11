"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, EmptyState, cn, IssueKey } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

const REASON = { assigned: "assigned you", mentioned: "mentioned you", watching: "updated an issue you watch" } as const;

export default function Inbox() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const list = useQuery(trpc.notification.list.queryOptions());
  const markRead = useMutation(
    trpc.notification.markRead.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.notification.pathKey() }) }),
  );
  const unread = list.data?.filter((n) => !n.readAt).length ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="page-title">Notifications</h1>
        {unread > 0 && <Button onClick={() => markRead.mutate({})}>Mark all as read</Button>}
      </div>
      {list.data?.length === 0 && <EmptyState title="You’re all caught up">Mentions, assignments and updates to issues you watch show up here.</EmptyState>}
      <ul className="divide-y divide-line overflow-hidden card empty:hidden">
        {list.data?.map((n) => (
          <li key={n.id} className={cn(!n.readAt && "bg-accent-soft/40")}>
            <Link href={n.issueKey ? `/i/${n.issueKey}` : "#"} onClick={() => !n.readAt && markRead.mutate({ ids: [n.id] })} className="flex gap-3 px-4 py-3 hover:bg-sunken">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-label={n.readAt ? undefined : "Unread"} />
              <span className="min-w-0 flex-1">
                <span className="block">
                  <span className="font-medium">{n.actorName}</span> {n.verb === "commented" && n.reason !== "mentioned" ? "commented on an issue you watch" : REASON[n.reason as keyof typeof REASON]}
                </span>
                <span className="flex items-center gap-2 text-muted">
                  {n.issueKey && <IssueKey k={n.issueKey} />}
                  <span className="truncate">{n.issueTitle}</span>
                </span>
              </span>
              <time className="shrink-0 text-[12px] text-muted">{new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
