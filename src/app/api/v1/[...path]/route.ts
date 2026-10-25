import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { authenticate } from "@/server/api-auth";
import { db } from "@/server/db";
import { hit } from "@/server/ratelimit";
import { createCaller } from "@/server/root";

/**
 * Public REST API. Auth: `Authorization: Bearer khira_…` (Settings → API tokens).
 * Every route goes through the same tRPC procedures the app uses, so validation and permissions are identical.
 *
 *   GET    /api/v1/projects
 *   GET    /api/v1/issues?kql=project%20%3D%20KHR&limit=50
 *   GET    /api/v1/issues/KHR-12
 *   POST   /api/v1/issues                 { projectKey, title, description?, type?, priority?, assigneeId? }
 *   PATCH  /api/v1/issues/KHR-12          { title?, description?, priority?, status?, assigneeId? }
 *   POST   /api/v1/issues/KHR-12/comments { body }
 */
const json = (data: unknown, status = 200) => Response.json(data, { status });

async function handle(req: Request, path: string[]) {
  const u = await authenticate(req);
  if (!u) return json({ error: "Invalid or missing API token." }, 401);
  if (!(await hit(`api:${u.tokenId}`, 300, 60))) return json({ error: "Rate limit: 300 requests per minute." }, 429);
  const api = createCaller({ db, user: u as never });
  const url = new URL(req.url);
  const body = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
  const [resource, key, sub] = path;

  if (resource === "projects" && !key && req.method === "GET") return json(await api.project.list());
  if (resource === "issues" && !key && req.method === "GET")
    return json(await api.search.query({ kql: url.searchParams.get("kql") ?? "", limit: Math.min(1000, Number(url.searchParams.get("limit") ?? 100)) }));
  if (resource === "issues" && !key && req.method === "POST") {
    const p = await api.project.byKey({ key: String(body.projectKey ?? "") });
    const { projectKey: _k, ...rest } = body;
    return json(await api.issue.create({ ...(rest as object), projectId: p.id } as never), 201);
  }
  if (resource === "issues" && key) {
    const pk = key.slice(0, key.lastIndexOf("-"));
    const found = await api.issue.byKey({ key: key as never });
    if (!sub && req.method === "GET") return json(found);
    if (!sub && req.method === "PATCH") {
      const { status, ...rest } = body as { status?: string } & Record<string, unknown>;
      let statusId: string | undefined;
      if (status) {
        const p = await api.project.byKey({ key: pk });
        statusId = p.statuses.find((s) => s.name.toLowerCase() === status.toLowerCase())?.id;
        if (!statusId) return json({ error: `Unknown status "${status}" in ${pk}.` }, 400);
      }
      return json(await api.issue.update({ ...(rest as object), statusId, id: found.issue.id } as never));
    }
    if (sub === "comments" && req.method === "POST") return json(await api.comment.create({ issueId: found.issue.id, body: String(body.body ?? "") }), 201);
  }
  return json({ error: "Not found" }, 404);
}

async function route(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    return await handle(req, (await params).path);
  } catch (e) {
    if (e instanceof TRPCError) return json({ error: e.message }, getHTTPStatusCodeFromError(e));
    console.error("api v1:", e);
    return json({ error: "Internal error" }, 500);
  }
}

export { route as GET, route as POST, route as PATCH };
