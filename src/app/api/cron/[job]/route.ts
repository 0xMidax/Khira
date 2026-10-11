import { safeEqual } from "@/lib/crypto";
import { db } from "@/server/db";
import { nightlyBackup } from "@/server/services/backup";
import { drainEvents } from "@/server/services/events";
import { checkSla, dailyNudges, draftStandups, postStandups, runRecurring, sendDigests } from "@/server/services/jobs";

export const maxDuration = 300;

const JOBS: Record<string, () => Promise<Record<string, unknown>>> = {
  // every 15 minutes
  frequent: async () => ({ ...(await runRecurring(db)), ...(await checkSla(db)) }),
  // once a day, early (UTC)
  daily: async () => ({ ...(await dailyNudges(db)), ...(await sendDigests(db)), ...(await draftStandups(db)) }),
  // a couple of hours after `daily`, so people can edit their standup first
  standup: () => postStandups(db),
  backup: () => nightlyBackup(db),
};

/** Vercel Cron calls these with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  const job = JOBS[(await params).job];
  if (!job) return new Response("Unknown job", { status: 404 });
  const started = Date.now();
  const result = await job();
  await drainEvents(); // finish emails/pushes before the function ends
  return Response.json({ ok: true, ms: Date.now() - started, ...result });
}
