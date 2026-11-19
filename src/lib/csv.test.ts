import { describe, expect, it } from "vitest";
import { mapHeader, mapPriority, mapType, parseCsv, parseLooseDate, toCsv } from "./csv";

describe("csv parsing and formatting", () => {
  describe("parseCsv", () => {
    it("parses simple comma-separated values", () => {
      const csv = "a,b,c\n1,2,3";
      expect(parseCsv(csv)).toEqual([
        ["a", "b", "c"],
        ["1", "2", "3"],
      ]);
    });

    it("handles quoted fields containing commas", () => {
      const csv = 'name,description\nTask 1,"Fix login, logout and cookies"';
      expect(parseCsv(csv)).toEqual([
        ["name", "description"],
        ["Task 1", "Fix login, logout and cookies"],
      ]);
    });

    it("handles escaped quotes inside quoted fields", () => {
      const csv = 'title,quote\n"He said ""Hello world!""","100% fine"';
      expect(parseCsv(csv)).toEqual([
        ["title", "quote"],
        ['He said "Hello world!"', "100% fine"],
      ]);
    });

    it("handles CRLF and LF line endings", () => {
      const csv = "col1,col2\r\nval1,val2\nval3,val4\r\n";
      expect(parseCsv(csv)).toEqual([
        ["col1", "col2"],
        ["val1", "val2"],
        ["val3", "val4"],
      ]);
    });

    it("handles newlines inside quoted fields", () => {
      const csv = 'id,content\n1,"Line 1\nLine 2\r\nLine 3"\n2,Done';
      expect(parseCsv(csv)).toEqual([
        ["id", "content"],
        ["1", "Line 1\nLine 2\r\nLine 3"],
        ["2", "Done"],
      ]);
    });

    it("strips UTF-8 BOM from start of text", () => {
      const csv = "\uFEFFheader1,header2\nval1,val2";
      expect(parseCsv(csv)).toEqual([
        ["header1", "header2"],
        ["val1", "val2"],
      ]);
    });

    it("skips empty rows", () => {
      const csv = "a,b\n\n\n1,2\n\n";
      expect(parseCsv(csv)).toEqual([
        ["a", "b"],
        ["1", "2"],
      ]);
    });
  });

  describe("toCsv", () => {
    it("formats header and rows with CRLF", () => {
      const header = ["Name", "Role"];
      const rows = [
        ["Alice", "Admin"],
        ["Bob", "User"],
      ];
      expect(toCsv(header, rows)).toBe("Name,Role\r\nAlice,Admin\r\nBob,User");
    });

    it("quotes cells that contain quotes, commas, or newlines", () => {
      const header = ["Title", "Note"];
      const rows = [
        ['Comma, here', 'Quotes "quoted"'],
        ["Multiline", "Line1\nLine2"],
      ];
      expect(toCsv(header, rows)).toBe(
        'Title,Note\r\n"Comma, here","Quotes ""quoted"""\r\nMultiline,"Line1\nLine2"'
      );
    });

    it("escapes formula injection prefixes with single quote", () => {
      const header = ["Formula"];
      const rows = [["=SUM(A1:A2)"], ["+123"], ["-cmd"], ["@calc"], ["\tindent"]];
      expect(toCsv(header, rows)).toBe(
        "Formula\r\n'=SUM(A1:A2)\r\n'+123\r\n'-cmd\r\n'@calc\r\n'\tindent"
      );
    });

    it("handles Date and null/undefined values", () => {
      const date = new Date("2026-03-14T12:00:00.000Z");
      const header = ["Date", "Empty", "Null"];
      const rows = [[date, undefined, null]];
      expect(toCsv(header, rows)).toBe(`Date,Empty,Null\r\n${date.toISOString()},,`);
    });
  });

  describe("mapHeader", () => {
    it("maps known Jira and standard headers case-insensitively", () => {
      expect(mapHeader("Summary")).toBe("title");
      expect(mapHeader(" TITLE ")).toBe("title");
      expect(mapHeader("description")).toBe("description");
      expect(mapHeader("Issue Type")).toBe("type");
      expect(mapHeader("TYPE")).toBe("type");
      expect(mapHeader("Priority")).toBe("priority");
      expect(mapHeader("Status")).toBe("status");
      expect(mapHeader("Assignee")).toBe("assignee");
      expect(mapHeader("Assignee Email")).toBe("assignee");
      expect(mapHeader("Due Date")).toBe("dueDate");
      expect(mapHeader("due")).toBe("dueDate");
      expect(mapHeader("Labels")).toBe("labels");
      expect(mapHeader("label")).toBe("labels");
      expect(mapHeader("Story Points")).toBe("estimate");
      expect(mapHeader("Custom field (Story Points)")).toBe("estimate");
      expect(mapHeader("estimate")).toBe("estimate");
      expect(mapHeader("story point estimate")).toBe("estimate");
      expect(mapHeader("custom field (story point estimate)")).toBe("estimate");
    });

    it("returns null for unrecognized headers", () => {
      expect(mapHeader("Sprint")).toBeNull();
      expect(mapHeader("Unknown Column")).toBeNull();
    });
  });

  describe("mapPriority", () => {
    it("maps urgent priorities", () => {
      expect(mapPriority("Highest")).toBe("urgent");
      expect(mapPriority("blocker")).toBe("urgent");
      expect(mapPriority("Critical")).toBe("urgent");
      expect(mapPriority("URGENT")).toBe("urgent");
    });

    it("maps high priorities", () => {
      expect(mapPriority("High")).toBe("high");
      expect(mapPriority("major")).toBe("high");
    });

    it("maps medium priorities", () => {
      expect(mapPriority("Medium")).toBe("medium");
      expect(mapPriority("normal")).toBe("medium");
    });

    it("maps low priorities", () => {
      expect(mapPriority("Low")).toBe("low");
      expect(mapPriority("lowest")).toBe("low");
      expect(mapPriority("minor")).toBe("low");
      expect(mapPriority("trivial")).toBe("low");
    });

    it("defaults unknown priority to none", () => {
      expect(mapPriority("unknown")).toBe("none");
      expect(mapPriority("")).toBe("none");
    });
  });

  describe("mapType", () => {
    it("maps issue types ignoring whitespace and hyphens", () => {
      expect(mapType("Bug")).toBe("bug");
      expect(mapType("Story")).toBe("story");
      expect(mapType("User Story")).toBe("story");
      expect(mapType("user-story")).toBe("story");
      expect(mapType("Epic")).toBe("epic");
      expect(mapType("Sub-task")).toBe("subtask");
      expect(mapType("sub task")).toBe("subtask");
      expect(mapType("subtask")).toBe("subtask");
    });

    it("defaults unknown types to task", () => {
      expect(mapType("Task")).toBe("task");
      expect(mapType("Feature")).toBe("task");
      expect(mapType("Improvement")).toBe("task");
    });
  });

  describe("parseLooseDate", () => {
    it("parses ISO date prefixes (YYYY-MM-DD)", () => {
      expect(parseLooseDate("2026-03-14")).toBe("2026-03-14");
      expect(parseLooseDate("2026-03-14T15:30:00Z")).toBe("2026-03-14");
    });

    it("parses Jira format DD/Mon/YY and DD/Mon/YYYY", () => {
      expect(parseLooseDate("14/Mar/26")).toBe("2026-03-14");
      expect(parseLooseDate("5/Jan/2025")).toBe("2025-01-05");
      expect(parseLooseDate("14/Mar/26 3:04 PM")).toBe("2026-03-14");
    });

    it("falls back to Date constructor for other valid formats", () => {
      expect(parseLooseDate("2026/10/19 12:00:00 UTC")).toBe("2026-10-19");
    });

    it("returns null for empty or invalid dates", () => {
      expect(parseLooseDate("")).toBeNull();
      expect(parseLooseDate("   ")).toBeNull();
      expect(parseLooseDate("14/Foo/26")).toBeNull();
      expect(parseLooseDate("not-a-date")).toBeNull();
    });
  });
});
