"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button, cn, Input } from "./ui";
import { useTRPC } from "@/trpc/react";

const FEATURES = [
  ["ai", "AI assist", "ANTHROPIC_API_KEY"],
  ["realtime", "Live updates", "PUSHER_KEY / Soketi"],
  ["push", "Push notifications", "VAPID keys"],
  ["storage", "Attachments in S3/R2", "S3_* (otherwise local disk)"],
] as const;

/** Server-level features turned on through environment settings (not from the app). */
export function ServerFeatures() {
  const trpc = useTRPC();
  const status = useQuery(trpc.integration.status.queryOptions());
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {FEATURES.map(([k, label, env]) => {
        const on = !!status.data?.[k];
        return (
          <li key={k} className="flex items-center gap-2.5 card px-3.5 py-2.5 text-[13px]">
            <span className={cn("size-2 rounded-full", on ? "bg-accent" : "bg-line")} aria-hidden />
            <span className="font-medium">{label}</span>
            <span className="ml-auto text-[12px] text-muted">{on ? "On" : `Set ${env}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function OutgoingWebhooks() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const hooks = useQuery(trpc.integration.webhooks.queryOptions());
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.integration.webhooks.queryKey() });
  const add = useMutation(
    trpc.integration.addWebhook.mutationOptions({
      onSuccess: (r) => (refresh(), prompt("Signing secret (shown once). Verify X-Khira-Signature: sha256=HMAC(secret, body)", r.secret)),
    }),
  );
  const remove = useMutation(trpc.integration.removeWebhook.mutationOptions({ onSuccess: refresh }));
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line card empty:hidden">
        {hooks.data?.map((h) => (
          <li key={h.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
            <code className="min-w-0 flex-1 truncate font-mono">{h.url}</code>
            <span className="text-muted">{h.events.join(", ")}</span>
            <span className={h.lastStatus && h.lastStatus < 300 ? "text-accent" : "text-muted"}>{h.lastStatus ? `last ${h.lastStatus}` : "not sent yet"}</span>
            <Button size="sm" variant="ghost" aria-label="Remove webhook" onClick={() => remove.mutate({ id: h.id })}>
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          add.mutate({ url: String(f.get("url")), events: String(f.get("events")).split(/[\s,]+/).filter(Boolean) });
        }}
      >
        <Input name="url" type="url" required placeholder="https://example.com/khira-hook" className="w-80 max-w-full" aria-label="Webhook URL" />
        <Input name="events" defaultValue="*" className="w-48 font-mono text-[12px]" aria-label="Events" />
        <Button>Add webhook</Button>
      </form>
    </div>
  );
}
