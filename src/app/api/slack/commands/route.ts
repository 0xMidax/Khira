import { db } from "@/server/db";
import { verifySlackRequest } from "@/server/integrations/slack";
import { handleSlashCommand } from "@/server/services/inbound";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifySlackRequest(req, raw))) return new Response("Bad signature", { status: 401 });
  const f = Object.fromEntries(new URLSearchParams(raw)) as { text: string; user_id: string; channel_id: string };
  return Response.json(await handleSlashCommand(db, f));
}
