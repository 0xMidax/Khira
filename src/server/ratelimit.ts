import "server-only";

/**
 * Fixed-window limiter. Upstash Redis when configured (shared across serverless instances),
 * otherwise per-instance memory — fine for one server or local dev.
 */
const mem = new Map<string, { n: number; reset: number }>();

export async function hit(key: string, max: number, windowSec: number): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const res = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify([
          ["INCR", `rl:${key}`],
          ["EXPIRE", `rl:${key}`, String(windowSec), "NX"],
        ]),
        signal: AbortSignal.timeout(1500),
      });
      const [{ result }] = (await res.json()) as [{ result: number }];
      return result <= max;
    } catch {
      // Fail open: a limiter outage must not take the app down.
      return true;
    }
  }
  const now = Date.now();
  const e = mem.get(key);
  if (!e || e.reset < now) {
    mem.set(key, { n: 1, reset: now + windowSec * 1000 });
    if (mem.size > 10_000) for (const [k, v] of mem) if (v.reset < now) mem.delete(k);
    return true;
  }
  e.n++;
  return e.n <= max;
}
