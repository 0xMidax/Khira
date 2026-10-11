// Mentions are stored inline as `@[Display Name](userId)`; the composer inserts them via autocomplete.
const MENTION = /@\[([^\]]+)\]\(([A-Za-z0-9_-]+)\)/g;

export function parseMentions(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((m) => m[2]))];
}

export function splitMentions(body: string): Array<string | { name: string; id: string }> {
  const out: Array<string | { name: string; id: string }> = [];
  let last = 0;
  for (const m of body.matchAll(MENTION)) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push({ name: m[1], id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}
