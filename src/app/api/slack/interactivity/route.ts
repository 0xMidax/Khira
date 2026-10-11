import { db } from "@/server/db";
import { verifySlackRequest } from "@/server/integrations/slack";
import { issueFromSlackMessage } from "@/server/services/inbound";

const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifySlackRequest(req, raw))) return new Response("Bad signature", { status: 401 });
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}");
  if (payload.type === "message_action" && payload.callback_id === "create_issue") {
    const key = await issueFromSlackMessage(db, {
      user_id: payload.user?.id,
      channel_id: payload.channel?.id,
      text: payload.message?.text ?? "",
      permalink: payload.message?.permalink,
    });
    if (payload.response_url)
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_type: "ephemeral", text: key ? `Created <${appUrl()}/i/${key}|${key}> (in Triage).` : "Create a project in Khira first." }),
      });
  }
  return new Response(null, { status: 200 });
}
