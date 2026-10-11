/** Finds issue keys like KHR-12 in free text, branch names (khr-12-fix-login) and commit messages. */
export function extractKeys(text: string, knownKeys?: Set<string>): { key: string; number: number }[] {
  const out = new Map<string, { key: string; number: number }>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})(?![0-9])/g)) {
    const key = m[1].toUpperCase();
    if (knownKeys && !knownKeys.has(key)) continue;
    out.set(`${key}-${m[2]}`, { key, number: Number(m[2]) });
  }
  return [...out.values()];
}
