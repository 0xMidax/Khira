import { describe, expect, it } from "vitest";
import { parseLooseDate } from "./csv";

describe("parseLooseDate", () => {
  it("keeps valid JIRA and ISO dates", () => {
    expect(parseLooseDate("14/Mar/26")).toBe("2026-03-14");
    expect(parseLooseDate("14/Mar/26 3:04 PM")).toBe("2026-03-14");
    expect(parseLooseDate("1/jan/2027")).toBe("2027-01-01");
    expect(parseLooseDate("2026-03-14")).toBe("2026-03-14");
    expect(parseLooseDate("2026-03-14T09:30:00Z")).toBe("2026-03-14");
  });

  it("accepts a real leap day", () => {
    expect(parseLooseDate("29/Feb/28")).toBe("2028-02-29");
    expect(parseLooseDate("2028-02-29")).toBe("2028-02-29");
  });

  it("rejects days that do not exist", () => {
    expect(parseLooseDate("31/Feb/26")).toBeNull();
    expect(parseLooseDate("29/Feb/26")).toBeNull(); // 2026 is not a leap year
    expect(parseLooseDate("32/Jan/26")).toBeNull();
    expect(parseLooseDate("0/Jan/26")).toBeNull();
    expect(parseLooseDate("31/Apr/26")).toBeNull();
  });

  it("rejects impossible ISO dates", () => {
    expect(parseLooseDate("2026-13-45")).toBeNull();
    expect(parseLooseDate("2026-02-30")).toBeNull();
    expect(parseLooseDate("2026-00-10")).toBeNull();
  });

  it("returns null for empty or unknown input", () => {
    expect(parseLooseDate("")).toBeNull();
    expect(parseLooseDate("   ")).toBeNull();
    expect(parseLooseDate("14/Foo/26")).toBeNull();
  });
});
