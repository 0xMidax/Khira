import { describe, expect, it } from "vitest";
import { parseMentions, splitMentions } from "./mentions";

describe("mentions helpers", () => {
  describe("parseMentions", () => {
    it("extracts unique user IDs from mention tokens", () => {
      const text = "Hey @[Alice Smith](user-1) and @[Bob Jones](user_2), please review.";
      expect(parseMentions(text)).toEqual(["user-1", "user_2"]);
    });

    it("deduplicates mentions referencing the same user ID", () => {
      const text = "@[Alice](u1) said something, then pinged @[Alice S](u1) again.";
      expect(parseMentions(text)).toEqual(["u1"]);
    });

    it("returns an empty array when there are no valid mentions", () => {
      expect(parseMentions("Hello @world and test@example.com")).toEqual([]);
      expect(parseMentions("@[Invalid]()")).toEqual([]);
      expect(parseMentions("")).toEqual([]);
    });
  });

  describe("splitMentions", () => {
    it("splits text with interspersed mentions into text chunks and objects", () => {
      const text = "Hello @[Jane Doe](user-123), please check @[Bob](user-456)!";
      expect(splitMentions(text)).toEqual([
        "Hello ",
        { name: "Jane Doe", id: "user-123" },
        ", please check ",
        { name: "Bob", id: "user-456" },
        "!",
      ]);
    });

    it("handles mention at the start of text", () => {
      const text = "@[Alice](alice-1) looks good";
      expect(splitMentions(text)).toEqual([
        { name: "Alice", id: "alice-1" },
        " looks good",
      ]);
    });

    it("handles mention at the end of text", () => {
      const text = "Thanks to @[Bob](bob-2)";
      expect(splitMentions(text)).toEqual([
        "Thanks to ",
        { name: "Bob", id: "bob-2" },
      ]);
    });

    it("handles adjacent mentions without intervening text", () => {
      const text = "@[Alice](u1)@[Bob](u2)";
      expect(splitMentions(text)).toEqual([
        { name: "Alice", id: "u1" },
        { name: "Bob", id: "u2" },
      ]);
    });

    it("returns a single string chunk when no mentions exist", () => {
      const text = "Plain text with no mentions";
      expect(splitMentions(text)).toEqual(["Plain text with no mentions"]);
    });

    it("returns an empty array for empty string", () => {
      expect(splitMentions("")).toEqual([]);
    });
  });
});
