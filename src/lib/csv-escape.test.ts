import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("toCsv formula guard", () => {
  it("writes negative numbers unchanged so they round-trip", () => {
    expect(toCsv(["pts"], [[-5]])).toBe("pts\r\n-5");
    expect(toCsv(["pts"], [[-0.5]])).toBe("pts\r\n-0.5");
    expect(parseCsv(toCsv(["pts"], [[-5]]))).toEqual([["pts"], ["-5"]]);
  });

  it("still prefixes text that would run as a formula", () => {
    expect(toCsv(["f"], [["=1+1"]])).toBe("f\r\n'=1+1");
    expect(toCsv(["f"], [["-cmd|' /C calc'!A0"]])).toBe("f\r\n'-cmd|' /C calc'!A0");
  });

  it("guards numeric-looking strings, since only a real number is known to be safe", () => {
    expect(toCsv(["f"], [["-5"]])).toBe("f\r\n'-5");
  });
});
