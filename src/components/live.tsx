"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { PublicConfig } from "@/lib/public-config";

/**
 * Live updates: with Pusher configured, any change to a project or to my notifications refetches what's on screen.
 * Without it we fall back to refetch-on-focus plus the 30s notification poll.
 */
export function useLiveUpdates(userId: string, projectIds: string[], cfg: PublicConfig["pusher"]) {
  const qc = useQueryClient();
  const key = projectIds.join(",");
  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    let cleanup = () => {};
    import("pusher-js").then(({ default: Pusher }) => {
      if (cancelled) return;
      const pusher = new Pusher(cfg.key, {
        cluster: cfg.cluster,
        // Soketi (self-hosted) needs its own host/port; Pusher's cloud doesn't.
        ...(cfg.host ? { wsHost: cfg.host, wsPort: cfg.port ?? 6001, wssPort: cfg.port ?? 6001, forceTLS: cfg.tls, enabledTransports: ["ws", "wss"] as ("ws" | "wss")[] } : {}),
        channelAuthorization: { endpoint: "/api/realtime/auth", transport: "ajax" },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Coalesce bursts (a drag fires several events) into one refetch.
      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => qc.invalidateQueries(), 300);
      };
      const channels = [`private-user-${userId}`, ...key.split(",").filter(Boolean).map((id) => `private-project-${id}`)];
      for (const c of channels) pusher.subscribe(c).bind("changed", refresh);
      cleanup = () => {
        clearTimeout(timer);
        pusher.disconnect();
      };
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [qc, userId, key, cfg]);
}

