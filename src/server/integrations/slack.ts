import { hmacHex, safeEqual } from "@/lib/crypto";
import { getConfig } from "./config";

export const slackReady = async () => !!(await getConfig("slack"));

export async function slackApi<T = Record<string, unknown>>(method: string, body: Record<string, unknown>, token?: string): Promise<T> {
  const botToken = token ?? (await getConfig("slack"))?.botToken;
  if (!botToken) throw new Error("Slack is not connected.");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

export const postSlack = (channel: string, text: string) => slackApi("chat.postMessage", { channel, text, unfurl_links: false });

/** https://api.slack.com/authentication/verifying-requests-from-slack */
export function verifySlack(rawBody: string, timestamp: string | null, signature: string | null, secret: string | null | undefined, now = Date.now()) {
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 60 * 5) return false; // replay window
  return safeEqual(`v0=${hmacHex(secret, `v0:${timestamp}:${rawBody}`)}`, signature);
}

export async function verifySlackRequest(req: Request, rawBody: string) {
  const secret = (await getConfig("slack"))?.signingSecret;
  return verifySlack(rawBody, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"), secret);
}
