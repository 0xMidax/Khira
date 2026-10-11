import Pusher from "pusher";
import { publicConfig } from "@/lib/public-config";

const cfg = publicConfig().pusher;
const pusher =
  cfg && process.env.PUSHER_APP_ID && process.env.PUSHER_SECRET
    ? new Pusher({
        appId: process.env.PUSHER_APP_ID,
        key: cfg.key,
        secret: process.env.PUSHER_SECRET,
        cluster: cfg.cluster,
        // Inside docker compose the server reaches Soketi directly (no TLS); browsers go through your public host.
        useTLS: process.env.PUSHER_INTERNAL_HOST ? false : cfg.tls,
        // Soketi: talk to your own server instead of Pusher's cloud.
        ...(cfg.host ? { host: process.env.PUSHER_INTERNAL_HOST ?? cfg.host, port: String(process.env.PUSHER_INTERNAL_PORT ?? cfg.port ?? 6001) } : {}),
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
