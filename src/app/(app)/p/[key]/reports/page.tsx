"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { Burndown, ChartCard, CreatedResolved, CumulativeFlow, CycleScatter, Empty, Stat, Velocity, Workload } from "@/components/charts";
import { cn, Select } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

const days1 = (n: number | null) => (n == null ? "—" : `${n < 1 ? n.toFixed(1) : Math.round(n)}d`);

export default function ReportsPage({ params }: { params: Promise<{ key: string }> }) {
  const key = use(params).key.toUpperCase();
  const trpc = useTRPC();
  const [range, setRange] = useState(30);
  const project = useQuery(trpc.project.byKey.queryOptions({ key }));
  const pid = project.data?.id ?? "00000000-0000-0000-0000-000000000000";
  const on = { enabled: !!project.data };
  const sprints = useQuery({ ...trpc.sprint.list.queryOptions({ projectId: pid }), ...on });
  const active = sprints.data?.find((s) => s.sprint.state === "active")?.sprint;
  const burndown = useQuery({ ...trpc.sprint.burndown.queryOptions({ id: active?.id ?? pid }), enabled: !!active });
  const velocity = useQuery({ ...trpc.sprint.velocity.queryOptions({ projectId: pid }), ...on });
  const cfd = useQuery({ ...trpc.reports.cfd.queryOptions({ projectId: pid, days: range }), ...on });
  const cycle = useQuery({ ...trpc.reports.cycleTime.queryOptions({ projectId: pid, days: Math.max(range, 30) }), ...on });
  const cvr = useQuery({ ...trpc.reports.createdVsResolved.queryOptions({ projectId: pid, days: range }), ...on });
  const workload = useQuery({ ...trpc.reports.workload.queryOptions({ projectId: pid }), ...on });
  const heat = useQuery({ ...trpc.reports.heatmap.queryOptions({ projectId: pid }), ...on });

  if (!project.data) return <p className="p-8 text-muted">Loading…</p>;
  const kanban = project.data.settings.method === "kanban";
  const maxHeat = Math.max(1, ...(heat.data?.cells.map((c) => c.points) ?? [1]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <Link href={`/p/${key}`} className="font-mono text-[12px] text-muted hover:text-ink">
            {key}
          </Link>
          <h1 className="text-2xl font-semibold">Reports</h1>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Range
          <Select value={range} onChange={(e) => setRange(Number(e.target.value))} className="w-32" aria-label="Date range">
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </Select>
        </label>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cycle time (median)" value={days1(cycle.data?.cycle.p50 ?? null)} hint={`85% within ${days1(cycle.data?.cycle.p85 ?? null)}`} />
        <Stat label="Lead time (median)" value={days1(cycle.data?.lead.p50 ?? null)} hint="Created to resolved" />
        <Stat label="Resolved" value={cycle.data?.count ?? "—"} hint={`Last ${Math.max(range, 30)} days`} />
        <Stat label="Open issues" value={workload.data?.reduce((n, w) => n + w.issues, 0) ?? "—"} hint={`${workload.data?.reduce((n, w) => n + w.overdue, 0) ?? 0} overdue`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {!kanban && (
          <>
        <ChartCard
          title="Sprint burndown"
          subtitle={active ? `${active.name}${burndown.data ? ` · ${burndown.data.done} of ${burndown.data.total} points done` : ""}` : undefined}
          table={burndown.data && { head: ["Day", "Guideline", "Remaining"], rows: burndown.data.days.map((d) => [d.date, d.ideal, d.remaining]) }}
        >
          {!active ? <Empty>Start a sprint from the backlog to see its burndown.</Empty> : burndown.data && <Burndown days={burndown.data.days} unit={burndown.data.unit} />}
        </ChartCard>

        <ChartCard title="Velocity" subtitle="Points committed vs completed, last 8 sprints" table={velocity.data && { head: ["Sprint", "Committed", "Completed"], rows: velocity.data.map((v) => [v.name, v.committed, v.completed]) }}>
          {velocity.data?.length ? <Velocity data={velocity.data} /> : <Empty>Velocity appears after your first completed sprint.</Empty>}
        </ChartCard>

          </>
        )}
        <ChartCard
          title="Cumulative flow"
          subtitle="Issues in each status per day; widening bands mean work is piling up"
          table={cfd.data && { head: ["Day", ...cfd.data.statuses.map((s) => s.name)], rows: cfd.data.points.map((p) => [String(p.date), ...cfd.data!.statuses.map((s) => Number((p as Record<string, unknown>)[s.id] ?? 0))]) }}
        >
          {cfd.data && <CumulativeFlow statuses={cfd.data.statuses} points={cfd.data.points as Record<string, number | string>[]} />}
        </ChartCard>

        <ChartCard title="Cycle time" subtitle="Each dot is a resolved issue: days from starting work to done" table={cycle.data && { head: ["Resolved", "Days"], rows: cycle.data.points.map((p) => [p.date, p.cycleDays]) }}>
          {cycle.data?.points.length ? <CycleScatter points={cycle.data.points} /> : <Empty>Resolve a few issues to see cycle time.</Empty>}
        </ChartCard>

        <ChartCard title="Created vs resolved" table={cvr.data && { head: ["Day", "Created", "Resolved"], rows: cvr.data.map((d) => [d.date, d.created, d.resolved]) }}>
          {cvr.data && <CreatedResolved data={cvr.data} />}
        </ChartCard>

        <ChartCard title="Open work per person" table={workload.data && { head: ["Person", "Issues", "In progress", "Points", "Overdue"], rows: workload.data.map((w) => [w.name, w.issues, w.inProgress, w.points, w.overdue]) }}>
          {workload.data?.length ? <Workload data={workload.data} /> : <Empty>No open issues.</Empty>}
        </ChartCard>
      </div>

      <section className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">Workload heatmap</h2>
        <p className="mb-3 text-[13px] text-muted">Points per person per sprint (unestimated issues count as 1). Darker means more load.</p>
        {heat.data?.sprints.length ? (
          <div className="overflow-x-auto">
            <table className="text-[12px]">
              <thead>
                <tr>
                  <th />
                  {heat.data.sprints.map((s) => (
                    <th key={s.id} className="px-2 py-1 text-left font-medium text-muted">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.data.people.map((p) => (
                  <tr key={p.id ?? "none"}>
                    <th className="pr-3 text-left font-medium">{p.name}</th>
                    {heat.data!.sprints.map((s) => {
                      const v = heat.data!.cells.find((c) => c.sprintId === s.id && c.userId === p.id)?.points ?? 0;
                      return (
                        <td key={s.id} className="p-0.5">
                          <div
                            className={cn("grid h-9 w-20 place-items-center rounded tabular-nums", v / maxHeat > 0.55 ? "text-white" : "text-ink")}
                            style={{ background: v ? `color-mix(in oklab, var(--series-1) ${Math.round(15 + (v / maxHeat) * 85)}%, var(--surface))` : "var(--sunken)" }}
                            title={`${p.name}, ${s.name}: ${v} points`}
                          >
                            {v || ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-muted">Create sprints and assign estimated issues to see the heatmap.</p>
        )}
      </section>
    </main>
  );
}
