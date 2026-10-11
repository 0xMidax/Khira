"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useShell } from "@/components/shell";
import { Avatar, Select } from "@/components/ui";
import { ROLES } from "@/lib/validators";
import { useTRPC } from "@/trpc/react";

const ROLE_HELP = { admin: "Everything, plus team and project settings", member: "Create and edit issues and projects", guest: "Read-only" };

export default function Team() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const users = useQuery(trpc.user.list.queryOptions());
  const setRole = useMutation(
    trpc.user.setRole.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: trpc.user.list.queryKey() });
        toast.success("Role updated");
      },
    }),
  );
  if (me.role !== "admin") return <p className="p-8 text-muted">Only admins can manage the team.</p>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <h1 className="mb-1 text-2xl font-semibold">Team</h1>
      <p className="mb-6 text-muted">
        People join by signing up with an email allowed in <code className="font-mono text-[12px]">ALLOWED_SIGNUPS</code>. New people start as members.
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {users.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar name={u.name} image={u.image} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{u.name}</span>
              <span className="block truncate text-[13px] text-muted">{u.email}</span>
            </span>
            <Select value={u.role} onChange={(e) => setRole.mutate({ userId: u.id, role: e.target.value as (typeof ROLES)[number] })} className="w-auto" aria-label={`Role for ${u.name}`} title={ROLE_HELP[u.role]}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)} · {ROLE_HELP[r]}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      <Workspace />
    </main>
  );
}

const INTEGRATIONS: [keyof IntegrationStatus, string, string][] = [
  ["email", "Email delivery", "RESEND_API_KEY"],
  ["ai", "AI features", "ANTHROPIC_API_KEY"],
  ["slack", "Slack", "SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET"],
  ["github", "GitHub", "GITHUB_WEBHOOK_SECRET"],
  ["inboundEmail", "Email to issue", "INBOUND_EMAIL_SECRET, INBOUND_EMAIL_DOMAIN"],
  ["realtime", "Live updates", "PUSHER_APP_ID, PUSHER_SECRET, NEXT_PUBLIC_PUSHER_KEY"],
  ["push", "Push notifications", "VAPID keys"],
  ["storage", "File storage (R2/S3)", "S3_*"],
];
type IntegrationStatus = { email: boolean; ai: boolean; slack: boolean; github: boolean; inboundEmail: boolean; realtime: boolean; push: boolean; storage: boolean };

function Workspace() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const status = useQuery(trpc.integration.status.queryOptions());
  const hooks = useQuery(trpc.integration.webhooks.queryOptions());
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.integration.webhooks.queryKey() });
  const add = useMutation(trpc.integration.addWebhook.mutationOptions({ onSuccess: (r) => (refresh(), prompt("Signing secret (shown once). Verify X-Khira-Signature: sha256=HMAC(secret, body)", r.secret)) }));
  const remove = useMutation(trpc.integration.removeWebhook.mutationOptions({ onSuccess: refresh }));
  return (
    <div className="mt-10 space-y-10">
      <section>
        <h2 className="mb-2 font-semibold">Integrations</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {INTEGRATIONS.map(([k, label, env]) => (
            <li key={k} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
              <span className={status.data?.[k] ? "text-accent" : "text-muted"} aria-hidden>
                {status.data?.[k] ? "●" : "○"}
              </span>
              <span className="font-medium">{label}</span>
              <span className="ml-auto text-[12px] text-muted">
                {status.data?.[k] ? "On" : ["email", "slack", "github", "inboundEmail"].includes(k) ? <a href="/settings/integrations" className="text-accent underline">Connect</a> : `Set ${env}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Outgoing webhooks</h2>
        <p className="mb-3 text-[13px] text-muted">POSTs JSON for issue events (issue.created, issue.updated, issue.commented…) to your URL, signed with HMAC-SHA256.</p>
        <ul className="mb-3 divide-y divide-line rounded-lg border border-line bg-surface empty:hidden">
          {hooks.data?.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <code className="min-w-0 flex-1 truncate font-mono">{h.url}</code>
              <span className="text-muted">{h.events.join(", ")}</span>
              <span className={h.lastStatus && h.lastStatus < 300 ? "text-accent" : "text-muted"}>{h.lastStatus ? `last ${h.lastStatus}` : "not sent yet"}</span>
              <button aria-label="Remove webhook" className="text-muted hover:text-danger" onClick={() => remove.mutate({ id: h.id })}>
                ×
              </button>
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
          <input name="url" type="url" required placeholder="https://example.com/khira-hook" className="h-8 w-80 max-w-full rounded-md border border-line bg-surface px-2.5" aria-label="Webhook URL" />
          <input name="events" defaultValue="*" className="h-8 w-56 rounded-md border border-line bg-surface px-2.5 font-mono text-[12px]" aria-label="Events" />
          <button className="h-8 rounded-md border border-line px-3 hover:bg-sunken">Add webhook</button>
        </form>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Backup</h2>
        <p className="mb-3 text-[13px] text-muted">Download everything (projects, issues, comments, history) as JSON. A copy is also saved to storage every night when the backup job runs.</p>
        <a href="/api/export?full=1" className="inline-flex h-8 items-center rounded-md border border-line px-3 hover:bg-sunken">
          Download backup
        </a>
      </section>
    </div>
  );
}
