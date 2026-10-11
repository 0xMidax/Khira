/** The Khira mark: a cucumber slice (skin ring, pale flesh, a ring of seeds). Scales cleanly at any size. */
export function Slice({ size = 24, className }: { size?: number; className?: string }) {
  const seeds = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + Math.cos(a) * 19, y: 50 + Math.sin(a) * 19, r: (a * 180) / Math.PI + 90 };
  });
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden>
      <circle cx="50" cy="50" r="48" fill="#2f7a3f" />
      <circle cx="50" cy="50" r="41" fill="#d9f4a0" />
      <circle cx="50" cy="50" r="29" fill="#c6f16d" />
      {seeds.map((s, i) => (
        <ellipse key={i} cx={s.x} cy={s.y} rx="3.2" ry="6" fill="#f4fbe6" transform={`rotate(${s.r} ${s.x} ${s.y})`} />
      ))}
    </svg>
  );
}

export function GithubMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}

/** Slack's four-colour hash, simplified. */
export function SlackMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <rect x="9" y="2" width="4" height="10" rx="2" fill="#36C5F0" />
      <rect x="2" y="11" width="10" height="4" rx="2" fill="#2EB67D" transform="translate(0 -2)" />
      <rect x="11" y="12" width="4" height="10" rx="2" fill="#ECB22E" />
      <rect x="12" y="11" width="10" height="4" rx="2" fill="#E01E5A" />
    </svg>
  );
}

export function DiscordMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <rect width="24" height="24" rx="6" fill="#5865F2" />
      <path d="M6.5 8.5c3.5-2 7.5-2 11 0l1 6.5c-1.5 1.3-3 2-4.3 2.2l-.7-1.2c-2 .6-4 .6-6 0l-.7 1.2C5.5 17 4 16.3 5.5 15z" fill="#fff" />
      <circle cx="9.6" cy="12.6" r="1.2" fill="#5865F2" />
      <circle cx="14.4" cy="12.6" r="1.2" fill="#5865F2" />
    </svg>
  );
}
