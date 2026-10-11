export type Rect = { top: number; left: number; width: number; height: number };

/** Where to put a popover of `size` next to `target` inside the viewport: right, then below, then above; always clamped on-screen. */
export function placePopover(target: Rect, viewport: { width: number; height: number }, size: { width: number; height: number }, gap = 12) {
  const clampX = (x: number) => Math.max(gap, Math.min(x, viewport.width - size.width - gap));
  const clampY = (y: number) => Math.max(gap, Math.min(y, viewport.height - size.height - gap));
  if (target.left + target.width + gap + size.width + gap <= viewport.width && target.width < viewport.width / 2)
    return { side: "right" as const, left: target.left + target.width + gap, top: clampY(target.top) };
  if (target.top + target.height + gap + size.height + gap <= viewport.height)
    return { side: "below" as const, left: clampX(target.left), top: target.top + target.height + gap };
  if (target.top - gap - size.height >= gap) return { side: "above" as const, left: clampX(target.left), top: target.top - gap - size.height };
  return { side: "center" as const, left: clampX((viewport.width - size.width) / 2), top: clampY((viewport.height - size.height) / 2) };
}

/** A target counts as visible only if it is at least partly on screen (the mobile sidebar sits off-canvas). */
export const isOnScreen = (r: Rect, viewport: { width: number; height: number }) =>
  r.width > 0 && r.height > 0 && r.left + r.width > 0 && r.top + r.height > 0 && r.left < viewport.width && r.top < viewport.height;
