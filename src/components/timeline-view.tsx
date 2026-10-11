"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn, IssueKey, Select, TypeIcon } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Dated issues of one project (a tab on the project page). */
export function TimelineView({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const [months, setMonths] = useState(3);
  const [epicsOnly, setEpicsOnly] = useState(true);
  const start = useMemo(() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return new Date(iso(d) + "T00:00:00Z");
  }, []);
  const end = new Date(start.getTime() + months * 31 * DAY);
  const items = useQuery(trpc.dashboard.dated.queryOptions({ projectId, from: iso(start), to: iso(end), epicsOnly }));
  const span = end.getTime() - start.getTime();
  const pct = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - start.getTime()) / span) * 100));
  const monthsList = Array.from({ length: months + 1 }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))).filter((m) => m < end);
  const today = pct(new Date());

  return (
    <div className="px-4 pb-6 md:px-6">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <p className="text-muted">Bars run from start date to due date. Give epics both dates to plan them here.</p>
        </div>
        <Select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-32" aria-label="Range">
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
        </Select>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={epicsOnly} onChange={(e) => setEpicsOnly(e.target.checked)} /> Epics only
        </label>
      </div>
      <div className="overflow-x-auto card">
        <div className="min-w-[900px]">
          <div className="relative ml-72 h-8 border-b border-line text-[12px] text-muted">
            {monthsList.map((m) => (
              <span key={m.toISOString()} className="absolute top-2 border-l border-line pl-1" style={{ left: `${pct(m)}%` }}>
                {m.toLocaleString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" })}
              </span>
            ))}
          </div>
          {items.data?.length === 0 && <p className="p-6 text-muted">Nothing dated in this range. Set a start and due date on an epic to plan it.</p>}
          {items.data?.map((i) => {
            const s = new Date(`${i.startDate ?? i.dueDate}T00:00:00Z`);
            const e = new Date(`${i.dueDate ?? i.startDate}T23:59:59Z`);
            const left = pct(s);
            const width = Math.max(0.8, pct(e) - left);
            return (
              <div key={i.id} className="flex items-center border-b border-line last:border-0">
                <Link href={`/i/${i.key}`} className="flex w-72 shrink-0 items-center gap-2 truncate px-3 py-2 hover:underline">
                  <TypeIcon type={i.type} size={14} />
                  <IssueKey k={i.key} />
                  <span className="truncate">{i.title}</span>
                </Link>
                <div className="relative h-9 flex-1">
                  <div className="absolute inset-y-0 w-px bg-danger/60" style={{ left: `${today}%` }} aria-hidden />
                  <Link
                    href={`/i/${i.key}`}
                    title={`${i.key}: ${i.startDate ?? "?"} → ${i.dueDate ?? "?"}${i.type === "epic" ? ` · ${Math.round(i.progress * 100)}% done` : ""}`}
                    className={cn("absolute top-2 h-5 overflow-hidden rounded", i.statusCategory === "done" ? "bg-muted/40" : "bg-[var(--series-1)]/25")}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    <span className="block h-full bg-[var(--series-1)]" style={{ width: `${i.statusCategory === "done" ? 100 : Math.round(i.progress * 100)}%` }} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
