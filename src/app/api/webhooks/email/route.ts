import { safeEqual } from "@/lib/crypto";
import { db } from "@/server/db";
import { getConfig, touchIntegration } from "@/server/integrations/config";
import { handleInboundEmail, type InboundEmail } from "@/server/services/inbound";

/** Postmark inbound webhook. The Integrations page shows the exact URL (with the secret) to paste into Postmark. */
export async function POST(req: Request) {
  const secret = (await getConfig("email"))?.inboundSecret;
  if (!secret) return new Response("Inbound email is not configured", { status: 404 });
  const expected = `Basic ${Buffer.from(`khira:${secret}`).toString("base64")}`;
  if (!safeEqual(req.headers.get("authorization") ?? "", expected)) return new Response("Unauthorized", { status: 401 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 2_000_000) return Response.json({ action: "ignored", reason: "too large" }); // 200 so Postmark doesn't retry
  const result = await handleInboundEmail(db, (await req.json()) as InboundEmail);
  void touchIntegration("email", { lastInboundAt: new Date().toISOString() });
  return Response.json(result);
}
