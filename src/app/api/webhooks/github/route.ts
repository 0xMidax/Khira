import { hmacHex, safeEqual } from "@/lib/crypto";
import { db } from "@/server/db";
import { getConfig, touchIntegration } from "@/server/integrations/config";
import { handleGithubEvent } from "@/server/services/github";

export async function POST(req: Request) {
  const secret = (await getConfig("github"))?.webhookSecret;
  if (!secret) return new Response("GitHub is not connected", { status: 404 });
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!safeEqual(`sha256=${hmacHex(secret, raw)}`, sig)) return new Response("Bad signature", { status: 401 });
  const event = req.headers.get("x-github-event") ?? "";
  void touchIntegration("github", { lastEventAt: new Date().toISOString(), lastEvent: event });
  if (event === "ping") return Response.json({ ok: true });
  const result = await handleGithubEvent(db, event, JSON.parse(raw));
  return Response.json(result);
}
