"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTRPC } from "@/trpc/react";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/validators";
import { Avatar, cn, IssueKey, PRIORITY_META, STATUS_DOT, TYPE_META, TypeIcon } from "./ui";

type Status = { id: string; name: string; color: string; category: string };

/** At-a-glance health of one project: counts, where work sits, who has it, and what's due next. */
export function ProjectSummary({ projectId, statuses }: { projectId: string; statuses: Status[] }) {
  const trpc = useTRPC();
  const list = useQuery(trpc.issue.list.queryOptions({ projectId }));
  // "Today" depends on the viewer's clock, so compute it in the browser only.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(new Date().toLocaleDateString("en-CA")), []);

  if (!list.data) return <p className="p-6 text-muted">Loading…</p>;
  const issues = list.data;
  const cat = new Map(statuses.map((s) => [s.id, s.category]));
  const open = issues.filter((i) => cat.get(i.statusId) !== "done");
  const overdue = today ? open.filter((i) => i.dueDate && i.dueDate < today) : [];
  const weekAhead = today ? new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10) : "";
  const dueSoon = today ? open.filter((i) => i.dueDate && i.dueDate >= today && i.dueDate <= weekAhead).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)) : [];
  const count = <K extends string>(keys: readonly K[], of: (i: (typeof issues)[number]) => K) => keys.map((k) => [k, issues.filter((i) => of(i) === k).length] as const);

  const people = new Map<string, { name: string; image: string | null; n: number }>();
  for (const i of open) {
    const k = i.assigneeName ?? "";
    const p = people.get(k) ?? { name: i.assigneeName ?? "Unassigned", image: i.assigneeImage, n: 0 };
    p.n++;
    people.set(k, p);
  }

  return (
    <div className="space-y-5 px-4 pb-8 md:px-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Open" value={open.length} />
        <Tile label="In progress" value={open.filter((i) => cat.get(i.statusId) === "in_progress").length} tone="accent" />
        <Tile label="Done" value={issues.length - open.length} />
        <Tile label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
      </div>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Status overview</h2>
        <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-sunken" aria-hidden>
          {statuses.map((s) => {
            const n = issues.filter((i) => i.statusId === s.id).length;
            return n ? <span key={s.id} className={cn("h-full", STATUS_DOT[s.color])} style={{ width: `${(n / issues.length) * 100}%` }} title={`${s.name}: ${n}`} /> : null;
          })}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          {statuses.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-full", STATUS_DOT[s.color])} aria-hidden />
              {s.name} <span className="font-semibold">{issues.filter((i) => i.statusId === s.id).length}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Bars title="Priority" rows={count(PRIORITIES, (i) => i.priority).map(([k, n]) => [PRIORITY_META[k].label, n])} />
        <Bars title="Types of work" rows={count(ISSUE_TYPES, (i) => i.type).map(([k, n]) => [TYPE_META[k].label, n])} />
        <Bars title="Open work by person" rows={[...people.values()].sort((a, b) => b.n - a.n).map((p) => [p.name, p.n, <Avatar key={p.name} name={p.name === "Unassigned" ? null : p.name} image={p.image} size={18} />])} />
      </div>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Due in the next 7 days</h2>
        {dueSoon.length ? (
          <ul className="divide-y divide-line">
            {dueSoon.map((i) => (
              <li key={i.id}>
                <Link href={`/i/${i.key}`} className="flex items-center gap-3 py-2 text-[13px] hover:text-accent">
                  <TypeIcon type={i.type} />
                  <IssueKey k={i.key} />
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="text-muted">{new Date(`${i.dueDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">Nothing due this week.</p>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "accent" | "danger" }) {
  return (
    <div className="card p-4">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className={cn("mt-1 font-[family-name:var(--font-display)] text-3xl font-bold", tone === "accent" && "text-accent", tone === "danger" && "text-danger")}>{value}</div>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: (readonly [string, number] | readonly [string, number, React.ReactNode])[] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const shown = rows.filter((r) => r[1] > 0);
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {shown.length ? (
        <ul className="space-y-2 text-[13px]">
          {shown.map(([label, n, icon]) => (
            <li key={label} className="grid grid-cols-[minmax(0,8rem)_1fr_2rem] items-center gap-2">
              <span className="flex items-center gap-1.5 truncate">
                {icon}
                {label}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="text-right font-semibold tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">No issues yet.</p>
      )}
    </section>
  );
}
