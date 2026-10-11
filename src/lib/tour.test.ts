import { describe, expect, it } from "vitest";
import { isOnScreen, placePopover } from "./tour";

const vp = { width: 1200, height: 800 };
const size = { width: 340, height: 230 };

describe("tour placement", () => {
  it("prefers the right of narrow targets (sidebar items)", () => {
    expect(placePopover({ top: 100, left: 12, width: 200, height: 32 }, vp, size)).toMatchObject({ side: "right", left: 224, top: 100 });
  });
  it("falls back to below, then above, and stays on screen", () => {
    expect(placePopover({ top: 100, left: 300, width: 800, height: 40 }, vp, size).side).toBe("below");
    expect(placePopover({ top: 700, left: 300, width: 800, height: 60 }, vp, size)).toMatchObject({ side: "above", top: 458 });
    const p = placePopover({ top: 790, left: 1150, width: 40, height: 10 }, vp, size);
    expect(p.left + size.width).toBeLessThanOrEqual(vp.width);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
  it("treats off-canvas targets (closed mobile sidebar) as hidden", () => {
    expect(isOnScreen({ top: 100, left: -240, width: 200, height: 32 }, vp)).toBe(false);
    expect(isOnScreen({ top: 100, left: 12, width: 200, height: 32 }, vp)).toBe(true);
  });
});
