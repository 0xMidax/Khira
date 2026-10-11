import { eq } from "drizzle-orm";
import { decrypt, hmacHex } from "@/lib/crypto";
import { db } from "../db";
import { outgoingWebhook } from "../db/schema";

/** Only public http(s) targets — blocks the obvious SSRF paths (localhost, private ranges, metadata IPs). */
export function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && process.env.NODE_ENV !== "production")) throw new Error("Webhook URLs must use https.");
  const h = u.hostname.toLowerCase();
  const privateHost =
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "[::1]" ||
    /^\[(fc|fd|fe80)/.test(h);
  if (privateHost && process.env.NODE_ENV === "production") throw new Error("Webhook URL must be a public address.");
  return u;
}

export async function deliverWebhooks(event: string, payload: Record<string, unknown>) {
  const hooks = await db.select().from(outgoingWebhook).where(eq(outgoingWebhook.enabled, true));
  const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
  await Promise.all(
    hooks
      .filter((h) => h.events.includes("*") || h.events.includes(event))
      .map(async (h) => {
        let status = 0;
        try {
          assertPublicUrl(h.url);
          const res = await fetch(h.url, {
            method: "POST",
            redirect: "manual", // a redirect could point somewhere private
            signal: AbortSignal.timeout(5000),
            headers: { "Content-Type": "application/json", "X-Khira-Event": event, "X-Khira-Signature": `sha256=${hmacHex(decrypt(h.secret), body)}` },
            body,
          });
          status = res.status;
        } catch (e) {
          console.warn(`webhook ${h.id} failed:`, (e as Error).message);
        }
        await db.update(outgoingWebhook).set({ lastStatus: status }).where(eq(outgoingWebhook.id, h.id));
      }),
  );
}
