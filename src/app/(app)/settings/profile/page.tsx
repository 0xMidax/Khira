"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/shell";
import { AgentConnect } from "@/components/agent-connect";
import { TwoFactorSection } from "@/components/two-factor";
import { Button, Input, Select } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function Profile() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const s = useQuery(trpc.settings.get.queryOptions());
  const tokens = useQuery(trpc.integration.tokens.queryOptions());
  const update = useMutation(trpc.settings.update.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.settings.get.queryKey() }), toast.success("Saved")) }));
  const sub = useMutation(trpc.settings.subscribePush.mutationOptions());
  const createToken = useMutation(trpc.integration.createToken.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.integration.tokens.queryKey() }) }));
  const revoke = useMutation(trpc.integration.revokeToken.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.integration.tokens.queryKey() }) }));
  const [newToken, setNewToken] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "denied">("off");
  const vapid = useShell().config.vapidPublicKey;

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapid) return setPushState("unsupported");
    if (Notification.permission === "denied") return setPushState("denied");
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((x) => setPushState(x ? "on" : "off"));
  }, [vapid]);

  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setPushState("denied");
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid!) });
    const j = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await sub.mutateAsync({ endpoint: j.endpoint, keys: j.keys });
    setPushState("on");
    toast.success("Push notifications on for this device");
  }

  if (!s.data) return <p className="p-8 text-muted">Loading…</p>;
  return (
    <main className="mx-auto max-w-2xl space-y-10 px-4 py-8 md:px-8">
      <h1 className="page-title">Your settings</h1>

      <section className="space-y-3">
        <h2 className="font-semibold">Notifications</h2>
        <label className="flex flex-wrap items-center gap-2">
          Email me
          <Select value={s.data.email} onChange={(e) => update.mutate({ email: e.target.value as "instant" })} className="w-56" aria-label="Email notifications">
            <option value="instant">for each update</option>
            <option value="digest">once a day (digest)</option>
            <option value="off">never</option>
          </Select>
        </label>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span>Push on this device:</span>
          {pushState === "on" && <span className="text-accent">On</span>}
          {pushState === "off" && <Button size="sm" onClick={enablePush}>Turn on</Button>}
          {pushState === "denied" && <span className="text-muted">Blocked in your browser settings.</span>}
          {pushState === "unsupported" && <span className="text-muted">Not available (install the app or ask an admin to configure push).</span>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Linked accounts</h2>
        <p className="text-[13px] text-muted">Lets Khira credit your Slack messages and GitHub pull requests to you.</p>
        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            update.mutate({ slackUserId: (f.get("slack") as string) || null, githubLogin: (f.get("github") as string) || null, timezone: String(f.get("tz")) });
          }}
        >
          <label>
            <span className="mb-1 block text-[12px] text-muted">Slack member ID</span>
            <Input name="slack" defaultValue={s.data.slackUserId ?? ""} placeholder="U04ABCDEF" pattern="[UW][A-Z0-9]{2,20}" />
          </label>
          <label>
            <span className="mb-1 block text-[12px] text-muted">GitHub username</span>
            <Input name="github" defaultValue={s.data.githubLogin ?? ""} placeholder="octocat" />
          </label>
          <label>
            <span className="mb-1 block text-[12px] text-muted">Time zone</span>
            <Input name="tz" defaultValue={s.data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} />
          </label>
          <Button variant="primary" className="w-fit">
            Save
          </Button>
        </form>
      </section>

      <TwoFactorSection />

      <AgentConnect />

      <section className="space-y-3">
        <h2 className="font-semibold">API tokens</h2>
        <p className="text-[13px] text-muted">
          For scripts, CI and coding agents. Send as <code className="font-mono">Authorization: Bearer …</code> to <code className="font-mono">/api/v1</code> or <code className="font-mono">/api/mcp</code>. Tokens act as you.
        </p>
        {newToken && (
          <div className="flex items-center gap-2 rounded-md border border-accent bg-accent-soft p-2 text-[13px]">
            <code className="min-w-0 flex-1 truncate font-mono">{newToken}</code>
            <Button size="sm" onClick={() => navigator.clipboard.writeText(newToken).then(() => toast.success("Copied"))}>
              <Copy size={13} /> Copy
            </Button>
            <span className="text-muted">You won’t see it again.</span>
          </div>
        )}
        <ul className="divide-y divide-line card empty:hidden">
          {tokens.data?.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="font-medium">{t.name}</span>
              <code className="font-mono text-muted">{t.prefix}…</code>
              <span className="text-muted">{t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}</span>
              <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Revoke ${t.name}`} onClick={() => revoke.mutate({ id: t.id })}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name"));
            createToken.mutate({ name }, { onSuccess: (r) => setNewToken(r.token) });
            e.currentTarget.reset();
          }}
        >
          <Input name="name" placeholder="Token name, e.g. CI" required maxLength={60} className="w-64" aria-label="Token name" />
          <Button>Create token</Button>
        </form>
      </section>
    </main>
  );
}
