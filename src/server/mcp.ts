import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/validators";
import type { createCaller } from "./root";

/**
 * MCP (Model Context Protocol) server for coding agents: Claude Code, Codex, Cursor…
 * Stateless "Streamable HTTP": each POST carries JSON-RPC and gets a JSON reply (no SSE, no sessions).
 * Every tool calls the same tRPC procedures as the app, so permissions and validation are identical.
 */
type Api = ReturnType<typeof createCaller>;
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = `Khira is the team's issue tracker. Issues have keys like KHR-12.
Find work with search_issues using KQL, e.g. \`assignee = me() and category != done\`, \`project = KHR and type = bug\`,
\`title ~ login\`, \`priority >= high\`, \`due < startOfDay()\`, \`order by priority desc\`.
Typical flow: my_issues or search_issues → get_issue (shows the project's statuses) → update_issue status as you work → add_comment with what you changed (link the branch/PR).
Name branches after the key (e.g. khr-12-fix-login): connected GitHub repos then move the issue along automatically.`;

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9]*-\d+$/, "an issue key like KHR-12").transform((k) => k.toUpperCase());
const person = z.string().describe('"me", or a teammate\'s email');

const tools = {
  list_projects: {
    description: "List the projects you can see, with their keys and open issue counts.",
    input: z.object({}),
    run: (api: Api) => api.project.list().then((ps) => ps.map(({ key, name, description, openIssues }) => ({ key, name, description, openIssues }))),
  },
  my_issues: {
    description: "Your open issues, most important first.",
    input: z.object({}),
    run: (api: Api) => search(api, "assignee = me() and category != done order by priority desc, due", 50),
  },
  search_issues: {
    description: "Find issues with a KQL query (see server instructions for syntax).",
    input: z.object({ kql: z.string().max(2000), limit: z.number().int().min(1).max(200).default(50) }),
    run: (api: Api, a: { kql: string; limit: number }) => search(api, a.kql, a.limit),
  },
  get_issue: {
    description: "Full details of one issue: description, status, people, subtasks, labels, comments, and the statuses it can move to.",
    input: z.object({ key }),
    run: async (api: Api, a: { key: string }) => {
      const d = await api.issue.byKey({ key: a.key as never });
      const [project, comments] = await Promise.all([api.project.byKey({ key: a.key.split("-")[0] }), api.comment.list({ issueId: d.issue.id })]);
      return {
        key: a.key,
        project: d.projectName,
        title: d.issue.title,
        type: d.issue.type,
        priority: d.issue.priority,
        status: d.status.name,
        assignee: d.assignee?.name ?? null,
        reporter: d.reporter.name,
        dueDate: d.issue.dueDate,
        estimate: d.issue.estimate,
        description: d.issue.description,
        parent: d.parent?.key ?? null,
        subtasks: d.children.map((c) => ({ key: c.key, title: c.title, status: c.statusName })),
        labels: d.labels.map((l) => l.name),
        comments: comments.map((c) => ({ author: c.authorName, at: c.createdAt, body: c.body })),
        availableStatuses: project.statuses.map((s) => s.name),
        url: `/i/${a.key}`,
      };
    },
  },
  create_issue: {
    description: "Create an issue. Returns its key.",
    input: z.object({
      projectKey: z.string(),
      title: z.string().min(1).max(255),
      description: z.string().max(50_000).optional().describe("Markdown"),
      type: z.enum(ISSUE_TYPES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      assignee: person.optional(),
      parentKey: key.optional().describe("Make it a subtask/child of this issue"),
    }),
    run: async (api: Api, a: { projectKey: string; title: string; description?: string; type?: (typeof ISSUE_TYPES)[number]; priority?: (typeof PRIORITIES)[number]; assignee?: string; parentKey?: string }) => {
      const p = await api.project.byKey({ key: a.projectKey.toUpperCase() });
      const row = await api.issue.create({
        projectId: p.id,
        title: a.title,
        description: a.description,
        type: a.type ?? "task",
        priority: a.priority ?? "none",
        assigneeId: a.assignee ? await userId(api, a.assignee) : undefined,
        parentId: a.parentKey ? (await api.issue.byKey({ key: a.parentKey as never })).issue.id : undefined,
      });
      return { key: row.key, url: `/i/${row.key}` };
    },
  },
  update_issue: {
    description: "Change an issue's status, assignee, priority, title or description. Only the fields you pass change.",
    input: z.object({
      key,
      status: z.string().optional().describe("A status name from get_issue's availableStatuses, e.g. In Progress"),
      assignee: person.nullable().optional().describe('"me", an email, or null to unassign'),
      priority: z.enum(PRIORITIES).optional(),
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(50_000).optional(),
    }),
    run: async (api: Api, a: { key: string; status?: string; assignee?: string | null; priority?: (typeof PRIORITIES)[number]; title?: string; description?: string }) => {
      const d = await api.issue.byKey({ key: a.key as never });
      let statusId: string | undefined;
      if (a.status) {
        const statuses = (await api.project.byKey({ key: a.key.split("-")[0] })).statuses;
        statusId = statuses.find((s) => s.name.toLowerCase() === a.status!.toLowerCase())?.id;
        if (!statusId) throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown status "${a.status}". Use one of: ${statuses.map((s) => s.name).join(", ")}.` });
      }
      await api.issue.update({
        id: d.issue.id,
        statusId,
        title: a.title,
        description: a.description,
        priority: a.priority,
        assigneeId: a.assignee === undefined ? undefined : a.assignee === null ? null : await userId(api, a.assignee),
      });
      return { key: a.key, updated: true };
    },
  },
  add_comment: {
    description: "Comment on an issue (Markdown). Use it to report progress, findings or a PR link.",
    input: z.object({ key, body: z.string().min(1).max(20_000) }),
    run: async (api: Api, a: { key: string; body: string }) => {
      const d = await api.issue.byKey({ key: a.key as never });
      await api.comment.create({ issueId: d.issue.id, body: a.body });
      return { key: a.key, commented: true };
    },
  },
} satisfies Record<string, { description: string; input: z.ZodObject; run: (api: Api, args: never) => Promise<unknown> }>;

async function search(api: Api, kql: string, limit: number) {
  const rows = await api.search.query({ kql, limit });
  return rows.map((r) => ({ key: r.key, title: r.title, type: r.type, status: r.statusName, priority: r.priority, assignee: r.assigneeName, dueDate: r.dueDate }));
}

async function userId(api: Api, who: string) {
  if (who.toLowerCase() === "me") return (await api.user.me()).id;
  const u = (await api.user.list()).find((x) => x.email.toLowerCase() === who.toLowerCase());
  if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: `No active teammate with the email ${who}.` });
  return u.id;
}

const toolList = Object.entries(tools).map(([name, t]) => {
  const { $schema: _, ...inputSchema } = z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>;
  return { name, description: t.description, inputSchema };
});

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } });

/** Handles one JSON-RPC message. Returns null for notifications (no reply). */
export async function handleMcp(msg: Rpc, api: Api) {
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid request");
  if (msg.id === undefined) return null; // notification, e.g. notifications/initialized
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "khira", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: toolList });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = (tools as Record<string, (typeof tools)[keyof typeof tools]>)[name];
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      // Tool failures go back as results with isError, so the agent can read them and retry.
      const parsed = tool.input.safeParse(msg.params?.arguments ?? {});
      if (!parsed.success) return ok(msg.id, { content: [{ type: "text", text: `Invalid arguments: ${z.prettifyError(parsed.error)}` }], isError: true });
      try {
        const out = await (tool.run as (api: Api, a: unknown) => Promise<unknown>)(api, parsed.data);
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        if (!(e instanceof TRPCError)) throw e;
        return ok(msg.id, { content: [{ type: "text", text: e.code === "NOT_FOUND" ? "Not found (or you don't have access)." : e.message }], isError: true });
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
