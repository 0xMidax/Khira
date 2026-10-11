import { describe, expect, it } from "vitest";
import { filterBoard } from "./board-filter";

const issues = [
  { key: "WEB-1", title: "Login broken", type: "bug", priority: "urgent", assigneeId: "me", labels: [{ name: "UI" }] },
  { key: "OPS-2", title: "Rotate keys", type: "task", priority: "low", assigneeId: null, labels: [] },
  { key: "WEB-3", title: "Dark mode", type: "story", priority: "medium", assigneeId: "bob", labels: [{ name: "ui" }] },
];
const keys = (f: Parameters<typeof filterBoard>[1]) => filterBoard(issues, f, "me").map((i) => i.key);

describe("team board filters", () => {
  it("filters by text, person, type, priority and label, combined", () => {
    expect(keys({})).toEqual(["WEB-1", "OPS-2", "WEB-3"]);
    expect(keys({ q: "web" })).toEqual(["WEB-1", "WEB-3"]);
    expect(keys({ q: "ROTATE" })).toEqual(["OPS-2"]);
    expect(keys({ assignee: "me" })).toEqual(["WEB-1"]);
    expect(keys({ assignee: "none" })).toEqual(["OPS-2"]);
    expect(keys({ assignee: "bob" })).toEqual(["WEB-3"]);
    expect(keys({ type: "bug" })).toEqual(["WEB-1"]);
    expect(keys({ priority: "low" })).toEqual(["OPS-2"]);
    expect(keys({ label: "ui" })).toEqual(["WEB-1", "WEB-3"]); // same label name in different projects
    expect(keys({ label: "ui", assignee: "bob" })).toEqual(["WEB-3"]);
  });
});
