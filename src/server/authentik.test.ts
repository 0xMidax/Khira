import { describe, expect, it } from "vitest";
import { khiraRole } from "./authentik";

describe("khiraRole", () => {
  it("maps the groups claim to a role", () => {
    expect(khiraRole(["khira-admin", "khira-member"])).toBe("admin");
    expect(khiraRole(["dashboard-viewer", "khira-member"])).toBe("member");
  });
  it("refuses anyone without a Khira group, and malformed claims", () => {
    expect(khiraRole(["dashboard-admin"])).toBeNull();
    expect(khiraRole([])).toBeNull();
    expect(khiraRole(undefined)).toBeNull();
    expect(khiraRole("khira-admin")).toBeNull();
  });
});
