import { describe, expect, it } from "vitest";
import { db } from "./db";
import { user } from "./db/schema";
import { handleMcp } from "./mcp";
import { createCaller } from "./root";

process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";

const mk = async (id: string) => {
  await db.insert(user).values({ id, name: id, email: `${id}@mcp.dev`, role: "member", emailVerified: true });
  return createCaller({ db, user: { id, role: "member", name: id, email: `${id}@mcp.dev` } as never });
};
const dev = await mk("dev");
const outsider = await mk("out");
await dev.project.create({ key: "AGT", name: "Agents" });

let n = 0;
const call = (api: typeof dev, method: string, params?: object) => handleMcp({ jsonrpc: "2.0", id: ++n, method, params: params as never }, api);
const tool = async (api: typeof dev, name: string, args: object) => {
  const r = (await call(api, "tools/call", { name, arguments: args })) as { result: { content: { text: string }[]; isError?: boolean } };
  return { error: !!r.result.isError, text: r.result.content[0].text, json: () => JSON.parse(r.result.content[0].text) };
};

describe("MCP server", () => {
  it("speaks the handshake", async () => {
    const init = (await call(dev, "initialize", { protocolVersion: "2025-03-26" })) as { result: { protocolVersion: string; capabilities: object } };
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.capabilities).toHaveProperty("tools");
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, dev)).toBeNull();
    const list = (await call(dev, "tools/list")) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain("update_issue");
    expect(list.result.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(await call(dev, "nope")).toMatchObject({ error: { code: -32601 } });
  });

  it("lets an agent pick up and work an issue", async () => {
    const { key } = (await tool(dev, "create_issue", { projectKey: "agt", title: "Fix login", type: "bug", priority: "high", assignee: "me" })).json();
    expect(key).toBe("AGT-1");
    expect((await tool(dev, "my_issues", {})).json().map((i: { key: string }) => i.key)).toEqual(["AGT-1"]);

    const bad = await tool(dev, "update_issue", { key: "agt-1", status: "Shipped-ish" });
    expect(bad.error).toBe(true);
    expect(bad.text).toMatch(/In Progress/); // tells the agent the valid statuses

    expect((await tool(dev, "update_issue", { key: "AGT-1", status: "in progress" })).error).toBe(false);
    await tool(dev, "add_comment", { key: "AGT-1", body: "Fixed in PR #4" });
    const issue = (await tool(dev, "get_issue", { key: "AGT-1" })).json();
    expect(issue).toMatchObject({ status: "In Progress", assignee: "dev", priority: "high" });
    expect(issue.comments[0].body).toBe("Fixed in PR #4");
    expect((await tool(dev, "search_issues", { kql: "title ~ login" })).json()).toHaveLength(1);
  });

  it("rejects bad input and respects access", async () => {
    expect((await tool(dev, "get_issue", { key: "not a key" })).text).toMatch(/Invalid arguments/);
    expect((await tool(dev, "create_issue", { projectKey: "AGT", title: "x", assignee: "nobody@x.dev" })).text).toMatch(/No active teammate/);
    await dev.project.setVisibility({ projectId: (await dev.project.byKey({ key: "AGT" })).id, visibility: "private" });
    const denied = await tool(outsider, "get_issue", { key: "AGT-1" });
    expect(denied).toMatchObject({ error: true, text: "Not found (or you don't have access)." });
  });
});

describe("POST /api/mcp", () => {
  it("authenticates with an API token and answers JSON-RPC over HTTP", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    const { token } = await dev.integration.createToken({ name: "agent" });
    const post = (body: unknown, auth = `Bearer ${token}`) =>
      POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) }));

    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "Bearer khira_wrong")).status).toBe(401);
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await post([])).status).toBe(400);
    expect((await post(Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" })))).status).toBe(400);
    const batch = await (await post([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "my_issues", arguments: {} } }])).json();
    expect(batch[0].result.serverInfo.name).toBe("khira");
    expect(JSON.parse(batch[1].result.content[0].text)[0].key).toBe("AGT-1");
  });
});
