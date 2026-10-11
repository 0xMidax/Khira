"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Live updates: with Pusher configured, any change to a project or to my notifications refetches what's on screen.
 * Without it we fall back to refetch-on-focus plus the 30s notification poll.
 */
export function useLiveUpdates(userId: string, projectIds: string[]) {
  const qc = useQueryClient();
  const key = projectIds.join(",");
  useEffect(() => {
    const appKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
    if (!appKey) return;
    let cancelled = false;
    let cleanup = () => {};
    import("pusher-js").then(({ default: Pusher }) => {
      if (cancelled) return;
      const pusher = new Pusher(appKey, { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "mt1", channelAuthorization: { endpoint: "/api/realtime/auth", transport: "ajax" } });
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
  }, [qc, userId, key]);
}

export const liveEnabled = !!process.env.NEXT_PUBLIC_PUSHER_KEY;
