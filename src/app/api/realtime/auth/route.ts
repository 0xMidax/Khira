import { getSession } from "@/server/auth";
import { authorizeChannel } from "@/server/integrations/realtime";

/** Pusher private-channel auth: your own user channel, and any project channel (everyone in the workspace can read every project). */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s?.user.emailVerified) return new Response("Unauthorized", { status: 401 });
  const f = new URLSearchParams(await req.text());
  const socketId = f.get("socket_id") ?? "";
  const channel = f.get("channel_name") ?? "";
  const ok = channel === `private-user-${s.user.id}` || /^private-project-[0-9a-f-]{36}$/.test(channel);
  if (!ok || !/^\d+\.\d+$/.test(socketId)) return new Response("Forbidden", { status: 403 });
  return Response.json(authorizeChannel(socketId, channel));
}
