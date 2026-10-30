import { describe, expect, it } from "vitest";
import { extractKeys } from "./issue-keys";

describe("extractKeys", () => {
  it("extracts issue keys from standard free text", () => {
    const text = "Working on KHR-12 and fixed PROJ-456 in this commit";
    expect(extractKeys(text)).toEqual([
      { key: "KHR", number: 12 },
      { key: "PROJ", number: 456 },
    ]);
  });

  it("extracts lowercase keys from git branch names", () => {
    const branch = "khr-12-fix-login-flow";
    expect(extractKeys(branch)).toEqual([{ key: "KHR", number: 12 }]);
  });

  it("extracts keys from commit messages with parentheses or punctuation", () => {
    const msg = "fix(auth): close [KHR-99] and (ENG-101)";
    expect(extractKeys(msg)).toEqual([
      { key: "KHR", number: 99 },
      { key: "ENG", number: 101 },
    ]);
  });

  it("deduplicates multiple mentions of the same key", () => {
    const text = "See KHR-12, also discussed in khr-12 and KHR-12";
    expect(extractKeys(text)).toEqual([{ key: "KHR", number: 12 }]);
  });

  it("filters extracted keys against knownKeys set", () => {
    const text = "KHR-12 is valid, but OTHER-99 is not in this project";
    const knownKeys = new Set(["KHR"]);
    expect(extractKeys(text, knownKeys)).toEqual([{ key: "KHR", number: 12 }]);
  });

  it("documents current behavior: without knownKeys, common prefixes like UTF-8 and ISO-8601 match", () => {
    // When knownKeys is omitted, any alphanumeric prefix conforming to the key pattern is matched.
    const text = "Ensure UTF-8 encoding complies with ISO-8601";
    expect(extractKeys(text)).toEqual([
      { key: "UTF", number: 8 },
      { key: "ISO", number: 8601 },
    ]);

    // Using knownKeys prevents these false positives:
    const knownKeys = new Set(["KHR"]);
    expect(extractKeys(text, knownKeys)).toEqual([]);
  });

  it("returns an empty array when no issue keys are present", () => {
    expect(extractKeys("Just regular text with no tickets")).toEqual([]);
    expect(extractKeys("")).toEqual([]);
  });

  it("ignores keys starting with a digit or having invalid format", () => {
    expect(extractKeys("1ABC-123 is invalid")).toEqual([]);
    expect(extractKeys("A-123 is too short of a prefix")).toEqual([]);
  });
});
