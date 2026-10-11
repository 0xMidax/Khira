/**
 * Browser-facing settings, read from the server's environment at request time (not baked in at build),
 * so one Docker image works for every self-hoster. NEXT_PUBLIC_* names still work for older setups.
 */
export type PublicConfig = {
  pusher: { key: string; cluster: string; host: string | null; port: number | null; tls: boolean } | null;
  vapidPublicKey: string | null;
};

export function publicConfig(): PublicConfig {
  const e = process.env;
  const key = e.PUSHER_KEY ?? e.NEXT_PUBLIC_PUSHER_KEY;
  return {
    pusher: key
      ? {
          key,
          cluster: e.PUSHER_CLUSTER ?? e.NEXT_PUBLIC_PUSHER_CLUSTER ?? "mt1",
          // Set for Soketi (self-hosted, Pusher-compatible); unset for Pusher's cloud.
          host: e.PUSHER_HOST || null,
          port: e.PUSHER_PORT ? Number(e.PUSHER_PORT) : null,
          tls: e.PUSHER_TLS !== "false",
        }
      : null,
    vapidPublicKey: e.VAPID_PUBLIC_KEY ?? e.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  };
}
