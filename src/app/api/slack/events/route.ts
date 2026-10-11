import { db } from "@/server/db";
import { slackApi, verifySlackRequest } from "@/server/integrations/slack";
import { unfurlsFor } from "@/server/services/inbound";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifySlackRequest(req, raw))) return new Response("Bad signature", { status: 401 });
  const body = JSON.parse(raw);
  if (body.type === "url_verification") return Response.json({ challenge: body.challenge });
  const ev = body.event;
  if (ev?.type === "link_shared") {
    const unfurls = await unfurlsFor(db, (ev.links ?? []).map((l: { url: string }) => l.url));
    if (Object.keys(unfurls).length) await slackApi("chat.unfurl", { channel: ev.channel, ts: ev.message_ts, unfurls }).catch((e) => console.warn("unfurl failed:", e.message));
  }
  return new Response(null, { status: 200 });
}
