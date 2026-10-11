"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ProjectIntegrations } from "@/app/(app)/p/[key]/settings/integrations";
import { DiscordMark, GithubMark, SlackMark } from "@/components/brand";
import { useShell } from "@/components/shell";
import { Button, cn, Input, Select } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

const ago = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString();
};

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <div className="mb-1 text-[12px] text-muted">{label}</div>
      <div className="flex items-center gap-1.5">
        <code className={cn("min-w-0 flex-1 truncate rounded-lg border border-line bg-sunken px-2.5 py-1.5 font-mono text-[12px]", secret && "border-lime/60 bg-lime/10")}>{value}</code>
        <Button
          size="sm"
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => navigator.clipboard.writeText(value).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
        >
          {done ? <Check size={13} /> : <Copy size={13} />}
        </Button>
      </div>
    </div>
  );
}

function Status({ on, source, extra }: { on: boolean; source?: "app" | "env"; extra?: string | null }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", on ? "bg-accent-soft text-accent" : "bg-sunken text-muted")}>
      {on ? (source === "env" ? "Connected via .env" : "Connected") : "Not connected"}
      {on && extra ? ` · ${extra}` : ""}
    </span>
  );
}

function Card({ icon, title, blurb, status, children }: { icon: React.ReactNode; title: string; blurb: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(19_33_26/0.05)]">
      <header className="mb-3 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-bg">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg">{title}</h2>
            {status}
          </div>
          <p className="text-[13px] text-muted">{blurb}</p>
        </div>
      </header>
      <div className="space-y-3 text-[13px]">{children}</div>
    </section>
  );
}

const Steps = ({ children }: { children: React.ReactNode }) => (
  <details className="rounded-lg border border-line bg-bg px-3 py-2">
    <summary className="cursor-pointer text-[13px] font-medium">Setup steps</summary>
    <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] text-muted">{children}</ol>
  </details>
);

export default function Integrations() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const c = useQuery({ ...trpc.integration.connections.queryOptions(), enabled: me.role === "admin" });
  const projects = useQuery(trpc.project.list.queryOptions());
  const [projectKey, setProjectKey] = useState("");
  const [ghSecret, setGhSecret] = useState<string | null>(null);
  const [inboundSecret, setInboundSecret] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.integration.pathKey() });
  const slack = useMutation(trpc.integration.connectSlack.mutationOptions({ onSuccess: (r) => (refresh(), toast.success(`Slack connected${r.team ? ` to ${r.team}` : ""}`)) }));
  const github = useMutation(trpc.integration.connectGithub.mutationOptions({ onSuccess: (r) => (refresh(), setGhSecret(r.secret)) }));
  const email = useMutation(
    trpc.integration.connectEmail.mutationOptions({
      onSuccess: (r) => {
        refresh();
        if (r.inboundSecret) setInboundSecret(r.inboundSecret);
        toast.success("Email settings saved");
      },
    }),
  );
  const testMail = useMutation(trpc.integration.sendTestEmail.mutationOptions({ onSuccess: () => toast.success(`Test email sent to ${me.email}`) }));
  const disconnect = useMutation(trpc.integration.disconnect.mutationOptions({ onSuccess: () => (refresh(), toast("Disconnected")) }));
  const pickedProject = projects.data?.find((p) => p.key === projectKey) ?? projects.data?.[0];

  if (me.role !== "admin") return <p className="p-8 text-muted">Only admins can manage integrations.</p>;
  if (!c.data) return <p className="p-8 text-muted">Loading…</p>;
  const d = c.data;
  const host = new URL(d.baseUrl).host;
  const isLocal = /localhost|127\.0\.0\.1/.test(host);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <h1 className="text-[2rem] leading-tight">Integrations</h1>
      <p className="mb-6 max-w-2xl text-muted">Connect the tools your team already uses. Updates flow to chat, email becomes issues, and GitHub moves work along the board on its own.</p>
      {isLocal && (
        <p className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]">
          You’re on {host}. Slack, GitHub and Postmark can’t reach your laptop, so their webhooks only work once Khira is deployed (or behind a tunnel such as ngrok, with BETTER_AUTH_URL set to it).
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ───────── GitHub ───────── */}
        <Card
          icon={<GithubMark />}
          title="GitHub"
          blurb="Link branches, commits and pull requests to issues, and move issues automatically."
          status={<Status on={!!d.github} source={d.github?.source} extra={d.github?.lastEventAt ? `last event ${ago(d.github.lastEventAt)}` : d.github ? "waiting for first event" : null} />}
        >
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-1.5 text-muted">Branch <code className="font-mono text-[12px]">khr-12-fix</code> created</td>
                <td className="py-1.5 text-right font-medium">→ In Progress, assigned to the developer</td>
              </tr>
              <tr>
                <td className="py-1.5 text-muted">Pull request opened</td>
                <td className="py-1.5 text-right font-medium">→ In Review</td>
              </tr>
              <tr>
                <td className="py-1.5 text-muted">Pull request merged</td>
                <td className="py-1.5 text-right font-medium">→ Done</td>
              </tr>
            </tbody>
          </table>
          {ghSecret ? (
            <div className="space-y-2 rounded-lg border border-lime/60 p-3">
              <p className="font-medium">Add this webhook to your GitHub repository or organization:</p>
              <CopyField label="Payload URL" value={d.urls.github} />
              <CopyField label="Secret (shown once)" value={ghSecret} secret />
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>GitHub → your repo (or org) → Settings → Webhooks → Add webhook.</li>
                <li>Paste the URL and secret. Content type: <b>application/json</b>.</li>
                <li>Choose “Let me select individual events”: <b>Branch or tag creation</b>, <b>Pull requests</b>, <b>Pushes</b>.</li>
              </ol>
              <Button size="sm" onClick={() => setGhSecret(null)}>
                I’ve added it
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => (!d.github || confirm("Make a new secret? You’ll need to paste it into GitHub again.")) && github.mutate()}>
                {d.github ? "New webhook secret" : "Connect GitHub"}
              </Button>
              {d.github?.source === "app" && (
                <Button variant="danger" onClick={() => confirm("Disconnect GitHub?") && disconnect.mutate({ kind: "github" })}>
                  Disconnect
                </Button>
              )}
            </div>
          )}
          <p className="text-[12px] text-muted">Each person links their GitHub username in Your settings so work is credited and assigned to them. Choose statuses per project below.</p>
        </Card>

        {/* ───────── Slack ───────── */}
        <Card
          icon={<SlackMark />}
          title="Slack"
          blurb="Post project updates to channels, create issues with /khira, preview issue links, and post daily standups."
          status={<Status on={!!d.slack} source={d.slack?.source} extra={d.slack?.team} />}
        >
          <Steps>
            <li>
              Create an app at{" "}
              <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-accent underline">
                api.slack.com/apps
              </a>{" "}
              (From scratch).
            </li>
            <li>OAuth & Permissions → Bot scopes: chat:write, commands, links:read, links:write → Install to workspace → copy the Bot token.</li>
            <li>Basic Information → copy the Signing Secret.</li>
            <li>Slash Commands → /khira → Request URL below. Interactivity → URL below, and add a message shortcut with callback ID create_issue.</li>
            <li>Event Subscriptions → URL below, bot event link_shared, and add {host} under App unfurl domains.</li>
          </Steps>
          <CopyField label="Slash command URL" value={d.urls.slackCommands} />
          <CopyField label="Interactivity URL" value={d.urls.slackInteractivity} />
          <CopyField label="Events URL" value={d.urls.slackEvents} />
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              slack.mutate({ botToken: String(f.get("bot")), signingSecret: String(f.get("sig")), standupChannel: String(f.get("standup")) });
            }}
          >
            <Input name="bot" type="password" autoComplete="off" placeholder={d.slack ? "Bot token (leave blank to keep)" : "xoxb-…"} aria-label="Bot token" />
            <Input name="sig" type="password" autoComplete="off" placeholder={d.slack ? "Signing secret (leave blank to keep)" : "Signing secret"} aria-label="Signing secret" />
            <Input name="standup" defaultValue={d.slack?.standupChannel ?? ""} placeholder="Standup channel ID (optional), e.g. C04ABCDEF" aria-label="Standup channel" className="sm:col-span-2" />
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" disabled={slack.isPending}>
                {slack.isPending ? "Checking…" : d.slack ? "Save" : "Connect Slack"}
              </Button>
              {d.slack?.source === "app" && (
                <Button type="button" variant="danger" onClick={() => confirm("Disconnect Slack?") && disconnect.mutate({ kind: "slack" })}>
                  Disconnect
                </Button>
              )}
            </div>
          </form>
        </Card>

        {/* ───────── Discord ───────── */}
        <Card
          icon={<DiscordMark />}
          title="Discord"
          blurb="Send a project’s new issues, status changes and comments to a Discord channel."
          status={<span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted">Per project</span>}
        >
          <Steps>
            <li>In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.</li>
            <li>Pick the project below, choose Discord, paste the URL and Connect. Khira sends a test message.</li>
          </Steps>
          <p className="text-muted">Discord is connected per project, in the project section at the bottom of this page.</p>
        </Card>

        {/* ───────── Email ───────── */}
        <Card
          icon={<Mail size={20} className="text-accent" />}
          title="Email"
          blurb="Send notifications and sign-up emails through Resend, and turn incoming email into issues."
          status={<Status on={!!d.email?.sending} source={d.email?.source} extra={d.email?.inbound ? `email-to-issue on${d.email.lastInboundAt ? `, last ${ago(d.email.lastInboundAt)}` : ""}` : null} />}
        >
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              email.mutate({ resendKey: String(f.get("key")), from: String(f.get("from")) });
            }}
          >
            <div className="text-[12px] font-medium">Sending (Resend)</div>
            <Input name="key" type="password" autoComplete="off" placeholder={d.email?.sending ? "API key (leave blank to keep)" : "re_…"} aria-label="Resend API key" />
            <Input name="from" defaultValue={d.email?.from ?? ""} placeholder="Khira <noreply@yourteam.dev>" aria-label="From address" />
            <div className="flex gap-2">
              <Button variant="primary" disabled={email.isPending}>
                Save
              </Button>
              {d.email?.sending && (
                <Button type="button" onClick={() => testMail.mutate()} disabled={testMail.isPending}>
                  Send me a test
                </Button>
              )}
            </div>
          </form>
          <form
            className="space-y-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              email.mutate({ inboundDomain: String(new FormData(e.currentTarget).get("domain")), enableInbound: true });
            }}
          >
            <div className="text-[12px] font-medium">Email to issue (Postmark inbound)</div>
            <Input name="domain" defaultValue={d.email?.inboundDomain ?? ""} placeholder="in.yourteam.dev" aria-label="Inbound domain" required />
            {inboundSecret && (
              <div className="space-y-2 rounded-lg border border-lime/60 p-3">
                <CopyField label="Postmark inbound webhook URL (contains the secret, shown once)" value={d.urls.email.replace("://", `://khira:${inboundSecret}@`)} secret />
                <p className="text-muted">In Postmark: Servers → your server → Inbound stream → Settings → Webhook URL. Point your domain’s MX record at Postmark.</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={email.isPending}>{d.email?.inbound ? "Save domain" : "Turn on email to issue"}</Button>
              {d.email?.inbound && (
                <Button type="button" onClick={() => confirm("Make a new secret? You’ll need to update Postmark.") && email.mutate({ rotateInbound: true })}>
                  New secret
                </Button>
              )}
            </div>
            <p className="text-[12px] text-muted">Mail to {"<project key>"}@{d.email?.inboundDomain ?? "your-domain"} lands in Triage. Replies to notification emails become comments.</p>
          </form>
          {d.email?.source === "app" && (
            <Button size="sm" variant="danger" onClick={() => confirm("Disconnect email?") && disconnect.mutate({ kind: "email" })}>
              Disconnect email
            </Button>
          )}
        </Card>
      </div>

      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="text-xl">Per project</h2>
            <p className="text-[13px] text-muted">Which channels get each project’s updates, and how GitHub moves its issues.</p>
          </div>
          {!!projects.data?.length && (
            <Select value={pickedProject?.key ?? ""} onChange={(e) => setProjectKey(e.target.value)} className="w-56" aria-label="Project">
              {projects.data.map((p) => (
                <option key={p.id} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        {pickedProject ? (
          <div className="rounded-2xl border border-line bg-surface p-5">
            <ProjectIntegrations key={pickedProject.id} projectId={pickedProject.id} projectKey={pickedProject.key} />
          </div>
        ) : (
          <p className="text-muted">Create a project first.</p>
        )}
      </section>
    </main>
  );
}
