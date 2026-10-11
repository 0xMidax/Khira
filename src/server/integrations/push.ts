import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db } from "../db";
import { pushSubscription } from "../db/schema";

// Browsers only ever hand out endpoints on these services; anything else could point the server at internal hosts (SSRF).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/];
export function isPushEndpoint(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((r) => r.test(u.hostname.toLowerCase().replace(/\.$/, "")));
  } catch {
    return false;
  }
}

const enabled = !!(process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
if (enabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

export async function pushTo(userIds: string[], payload: { title: string; body: string; url: string }) {
  if (!enabled || !userIds.length) return;
  const subs = await db.select().from(pushSubscription).where(inArray(pushSubscription.userId, userIds));
  await Promise.all(
    subs.filter((s) => isPushEndpoint(s.endpoint)).map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload)).catch(async (e: { statusCode?: number }) => {
        // Gone/expired subscriptions are removed so we stop trying.
        if (e.statusCode === 404 || e.statusCode === 410) await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id));
      }),
    ),
  );
}
