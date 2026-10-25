import { authenticate } from "@/server/api-auth";
import { db } from "@/server/db";
import { handleMcp } from "@/server/mcp";
import { hit } from "@/server/ratelimit";
import { createCaller } from "@/server/root";

/**
 * MCP endpoint for coding agents (Claude Code, Codex, Cursor…). Auth: `Authorization: Bearer khira_…`.
 * Setup instructions live under Your settings → Connect a coding agent.
 */
const MAX_BATCH = 20;

export async function POST(req: Request) {
  const u = await authenticate(req);
  if (!u) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or missing API token. Create one under Your settings → API tokens." } }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const msgs = Array.isArray(body) ? body : [body];
  if (!msgs.length || msgs.length > MAX_BATCH) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Invalid request: a batch holds 1 to ${MAX_BATCH} messages.` } }, { status: 400 });
  // Each message counts against the token's limit, so a batch is no way around it.
  for (const _ of msgs) if (!(await hit(`api:${u.tokenId}`, 300, 60))) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Rate limit: 300 requests per minute." } }, { status: 429 });

  const api = createCaller({ db, user: u as never });
  const run = async (m: unknown) => {
    try {
      return await handleMcp(m as never, api);
    } catch (e) {
      console.error("mcp:", e);
      return { jsonrpc: "2.0", id: (m as { id?: unknown })?.id ?? null, error: { code: -32603, message: "Internal error" } };
    }
  };
  const replies = (await Promise.all(msgs.map(run))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 }); // only notifications
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}

// No server-initiated stream and no sessions: clients fall back to plain POSTs.
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export { notAllowed as GET, notAllowed as DELETE };
