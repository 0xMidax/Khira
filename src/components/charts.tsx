"use client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Categorical slots in fixed order (validated palette, light + dark tokens in globals.css).
export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

const axis = { stroke: "var(--line)", tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false } as const;
const grid = <CartesianGrid stroke="var(--line)" strokeDasharray="0" vertical={false} />;
const tooltip = (
  <Tooltip
    contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)", fontSize: 12 }}
    labelStyle={{ color: "var(--muted)" }}
    cursor={{ stroke: "var(--muted)", strokeWidth: 1, fill: "var(--sunken)" }}
  />
);
const legend = <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink)" }} iconType="plainline" />;
const short = (d: string) => d.slice(5);

export function ChartCard({ title, subtitle, children, table }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; table?: { head: string[]; rows: (string | number | null)[][] } }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="mb-2 text-[13px] text-muted">{subtitle}</p>}
      <div className="h-64">{children}</div>
      {table && table.rows.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-muted hover:text-ink">Show as table</summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-muted">
                <tr>{table.head.map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {r.map((c, j) => (
                      <td key={j} className="px-2 py-1 tabular-nums">
                        {c ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center text-center text-[13px] text-muted">{children}</div>;
}

export function Burndown({ days, unit }: { days: { date: string; ideal: number; remaining: number | null }[]; unit: string }) {
  return (
    <ResponsiveContainer>
      <LineChart data={days} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        {grid}
        <XAxis dataKey="date" tickFormatter={short} {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        {tooltip}
        {legend}
        <Line name="Guideline" dataKey="ideal" stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line name={`Remaining ${unit}`} dataKey="remaining" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Velocity({ data }: { data: { name: string; committed: number | null; completed: number | null }[] }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barGap={2}>
        {grid}
        <XAxis dataKey="name" {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        {tooltip}
        {legend}
        <Bar name="Committed" dataKey="committed" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        <Bar name="Completed" dataKey="completed" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CumulativeFlow({ statuses, points }: { statuses: { id: string; name: string }[]; points: Record<string, number | string>[] }) {
  // Stack done at the bottom (JIRA convention): reverse workflow order.
  const stack = [...statuses].reverse();
  return (
    <ResponsiveContainer>
      <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        {grid}
        <XAxis dataKey="date" tickFormatter={short} {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        {tooltip}
        {legend}
        {stack.map((s) => {
          const color = SERIES[statuses.findIndex((x) => x.id === s.id) % SERIES.length];
          return <Area key={s.id} name={s.name} dataKey={s.id} stackId="1" stroke="var(--surface)" strokeWidth={2} fill={color} fillOpacity={0.85} isAnimationActive={false} />;
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CycleScatter({ points }: { points: { date: string; cycleDays: number }[] }) {
  const data = points.map((p) => ({ x: new Date(p.date).getTime(), y: p.cycleDays }));
  return (
    <ResponsiveContainer>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        {grid}
        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toISOString().slice(5, 10)} {...axis} />
        <YAxis dataKey="y" name="Days" {...axis} />
        {tooltip}
        <Scatter name="Cycle time (days)" data={data} fill={SERIES[0]} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function CreatedResolved({ data }: { data: { date: string; created: number; resolved: number }[] }) {
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        {grid}
        <XAxis dataKey="date" tickFormatter={short} {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        {tooltip}
        {legend}
        <Line name="Created" dataKey="created" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line name="Resolved" dataKey="resolved" stroke={SERIES[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Workload({ data }: { data: { name: string; points: number; issues: number }[] }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, bottom: 0, left: 24 }}>
        <CartesianGrid stroke="var(--line)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axis} />
        <YAxis type="category" dataKey="name" width={90} {...axis} />
        {tooltip}
        <Bar name="Open issues" dataKey="issues" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[12px] text-muted">{hint}</div>}
    </div>
  );
}
