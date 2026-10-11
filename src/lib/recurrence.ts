export type Recurrence = { freq: "daily" | "weekly" | "monthly"; interval: number; weekday?: number; monthDay?: number; hour?: number };

/**
 * Next run strictly after `after` (UTC). weekday: 0=Sun..6=Sat; monthDay capped at 28 so every month has it.
 * The first run lands on the next matching slot; later runs step by `interval`.
 */
export function nextRun(r: Recurrence, after: Date, previous?: Date): Date {
  const hour = r.hour ?? 9;
  const at = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(hour, 0, 0, 0);
    return x;
  };
  if (previous) {
    const n = new Date(previous);
    if (r.freq === "daily") n.setUTCDate(n.getUTCDate() + r.interval);
    if (r.freq === "weekly") n.setUTCDate(n.getUTCDate() + 7 * r.interval);
    if (r.freq === "monthly") n.setUTCMonth(n.getUTCMonth() + r.interval);
    // If the job was down for a while, skip missed slots instead of firing a burst.
    return n > after ? n : nextRun(r, after, n);
  }
  let d = at(after);
  if (r.freq === "daily") {
    if (d <= after) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  if (r.freq === "weekly") {
    const wd = r.weekday ?? 1;
    d.setUTCDate(d.getUTCDate() + ((wd - d.getUTCDay() + 7) % 7));
    if (d <= after) d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  const md = r.monthDay ?? 1;
  d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), md, hour));
  if (d <= after) d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, md, hour));
  return d;
}

export function describeRecurrence(r: Recurrence) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const every = r.interval === 1 ? "Every" : `Every ${r.interval}`;
  const time = `at ${String(r.hour ?? 9).padStart(2, "0")}:00 UTC`;
  if (r.freq === "daily") return `${every} ${r.interval === 1 ? "day" : "days"} ${time}`;
  if (r.freq === "weekly") return `${every} ${r.interval === 1 ? "week" : "weeks"} on ${days[r.weekday ?? 1]} ${time}`;
  return `${every} ${r.interval === 1 ? "month" : "months"} on day ${r.monthDay ?? 1} ${time}`;
}
