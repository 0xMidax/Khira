import Pusher from "pusher";

// ponytail: without PUSHER_* the client falls back to polling; set them for live boards.
const pusher =
  process.env.PUSHER_APP_ID && process.env.PUSHER_SECRET && process.env.NEXT_PUBLIC_PUSHER_KEY
    ? new Pusher({
        appId: process.env.PUSHER_APP_ID,
        key: process.env.NEXT_PUBLIC_PUSHER_KEY,
        secret: process.env.PUSHER_SECRET,
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "mt1",
        useTLS: true,
      })
    : null;

export const realtimeEnabled = !!pusher;

/** Private channels only: clients must pass /api/realtime/auth. Payloads carry ids, never content. */
export async function publish(channels: string[], event: string, data: Record<string, unknown>) {
  if (!pusher || !channels.length) return;
  for (let i = 0; i < channels.length; i += 100) await pusher.trigger(channels.slice(i, i + 100).map((c) => `private-${c}`), event, data);
}

export function authorizeChannel(socketId: string, channel: string) {
  if (!pusher) throw new Error("Realtime is not configured.");
  return pusher.authorizeChannel(socketId, channel);
}
