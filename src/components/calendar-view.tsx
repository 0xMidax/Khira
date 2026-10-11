"use client";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, cn, IssueKey } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Due dates of one project by month (a tab on the project page). */
export function CalendarView({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), 1));
  });
  const first = new Date(month);
  const gridStart = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * 86_400_000);
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * 86_400_000));
  const items = useQuery(trpc.dashboard.dated.queryOptions({ projectId, from: iso(days[0]), to: iso(days[41]) }));
  const byDay = new Map<string, NonNullable<typeof items.data>>();
  for (const i of items.data ?? []) if (i.dueDate) byDay.set(i.dueDate, [...(byDay.get(i.dueDate) ?? []), i]);
  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD, not UTC
  const shift = (n: number) => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1)));

  return (
    <div className="px-4 pb-6 md:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl">{month.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <Button size="sm" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft size={15} />
        </Button>
        <Button size="sm" onClick={() => setMonth(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1)))}>
          Today
        </Button>
        <Button size="sm" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight size={15} />
        </Button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-line bg-line text-[12px]" style={{ gap: 1 }}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-surface px-2 py-1 font-medium text-muted">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const k = iso(d);
          const list = byDay.get(k) ?? [];
          const other = d.getUTCMonth() !== month.getUTCMonth();
          return (
            <div key={k} className={cn("min-h-24 bg-surface p-1.5", other && "bg-sunken/60")}>
              <div className={cn("mb-1 text-right", k === today ? "font-semibold text-accent" : other ? "text-muted/60" : "text-muted")}>{d.getUTCDate()}</div>
              <ul className="space-y-0.5">
                {list.slice(0, 4).map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`/i/${i.key}`}
                      title={i.title}
                      className={cn("block truncate rounded px-1 hover:bg-sunken", i.statusCategory === "done" ? "text-muted line-through" : k < today ? "text-danger" : "")}
                    >
                      <IssueKey k={i.key} className="text-[11px]" /> {i.title}
                    </Link>
                  </li>
                ))}
                {list.length > 4 && <li className="px-1 text-muted">+{list.length - 4} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
