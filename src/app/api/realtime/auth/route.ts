import { loadAccess } from "@/server/access";
import { getMember } from "@/server/auth";
import { db } from "@/server/db";
import { authorizeChannel } from "@/server/integrations/realtime";

/** Pusher private-channel auth: your own user channel, and the channels of projects you can see. */
export async function POST(req: Request) {
  const me = await getMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const f = new URLSearchParams(await req.text());
  const socketId = f.get("socket_id") ?? "";
  const channel = f.get("channel_name") ?? "";
  const projectId = /^private-project-([0-9a-f-]{36})$/.exec(channel)?.[1];
  const ok = channel === `private-user-${me.id}` || (!!projectId && !!(await loadAccess(db, me)).roleIn(projectId));
  if (!ok || !/^\d+\.\d+$/.test(socketId)) return new Response("Forbidden", { status: 403 });
  return Response.json(authorizeChannel(socketId, channel));
}
