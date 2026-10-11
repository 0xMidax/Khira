"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FocusBar, FocusButton, useFocus } from "@/components/focus-timer";
import { useShell } from "@/components/shell";
import { Button, cn, IssueKey, Kbd, PriorityIcon, TypeIcon } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

export default function MyWork() {
  const trpc = useTRPC();
  const { me, openCreate } = useShell();
  const q = useQuery(trpc.issue.mine.queryOptions());
  const focus = useFocus();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const today = new Date().toISOString().slice(0, 10);
  const groups = [
    { title: "Overdue", items: q.data?.filter((i) => i.dueDate && i.dueDate < today) ?? [] },
    { title: "In progress", items: q.data?.filter((i) => !(i.dueDate && i.dueDate < today) && i.statusCategory === "in_progress") ?? [] },
    { title: "Up next", items: q.data?.filter((i) => !(i.dueDate && i.dueDate < today) && i.statusCategory === "todo") ?? [] },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      {/* The date depends on the viewer's locale and timezone, so render it only in the browser (avoids a hydration mismatch). */}
      <p className="mb-1 min-h-5 text-[13px] font-medium text-accent">{now?.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      <h1 className="page-title">Good to see you, {me.name.split(" ")[0]}</h1>
      <div className="mt-3 mb-8 flex flex-wrap items-center gap-2 text-[13px]">
        {q.data ? (
          q.data.length ? (
            groups.map((g) => (
              <span
                key={g.title}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 font-medium",
                  g.title === "Overdue" ? (g.items.length ? "border-danger/30 bg-danger/10 text-danger" : "border-line text-muted") : g.title === "In progress" ? "border-accent/30 bg-accent-soft text-accent" : "border-line bg-surface text-muted",
                )}
              >
                {g.items.length} {g.title.toLowerCase()}
              </span>
            ))
          ) : (
            <span className="text-muted">Nothing is assigned to you right now.</span>
          )
        ) : null}
      </div>
      <FocusBar running={focus.running} stop={focus.stop} />
      {q.data?.length === 0 && (
        <div className="rounded-lg border border-dashed border-line p-8 text-center">
          <p className="mb-3 text-muted">Pick something up from a project board, or capture a new task.</p>
          <Button variant="primary" onClick={() => openCreate()}>
            New issue
          </Button>
          <p className="mt-3 text-[12px] text-muted">
            Tip: press <Kbd>C</Kbd> anywhere to create, <Kbd>⌘</Kbd> <Kbd>K</Kbd> to search. New here? Use “Take the tour” in the sidebar.
          </p>
        </div>
      )}
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.title} className="mb-8">
            <h2 className={cn("mb-2 text-lg", g.title === "Overdue" && "text-danger")}>
              {g.title} <span className="font-normal text-muted">{g.items.length}</span>
            </h2>
            <ul className="divide-y divide-line overflow-hidden card">
              {g.items.map((i) => (
                <li key={i.id}>
                  <Link href={`/i/${i.key}`} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-sunken">
                    <FocusButton active={focus.running?.issueId === i.id} onStart={() => focus.start({ issueId: i.id, key: i.key, title: i.title })} />
                    <PriorityIcon priority={i.priority} />
                    <TypeIcon type={i.type} />
                    <IssueKey k={i.key} className="w-20 shrink-0" />
                    <span className="flex-1 truncate">{i.title}</span>
                    <span className="hidden text-[12px] text-muted sm:inline">{i.statusName}</span>
                    {i.dueDate && <span className={cn("text-[12px]", i.dueDate < today ? "text-danger" : "text-muted")}>{i.dueDate}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </main>
  );
}
