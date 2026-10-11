"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input, Select } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

const EVENTS = [
  ["created", "New issues"],
  ["statusChanged", "Status changes"],
  ["commented", "Comments"],
  ["released", "Releases"],
] as const;

function Off({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-line p-3 text-[13px] text-muted">{children}</p>;
}

export function ProjectIntegrations({ projectId, projectKey }: { projectId: string; projectKey: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const status = useQuery(trpc.integration.status.queryOptions());
  const channels = useQuery(trpc.integration.channels.queryOptions({ projectId }));
  const wf = useQuery(trpc.workflow.get.queryOptions({ projectId }));
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.integration.pathKey() });
  const add = useMutation(trpc.integration.addChannel.mutationOptions({ onSuccess: () => (refresh(), toast.success("Channel connected")) }));
  const remove = useMutation(trpc.integration.removeChannel.mutationOptions({ onSuccess: refresh }));
  const saveGh = useMutation(trpc.workflow.updateSettings.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.workflow.pathKey() }), toast.success("Saved")) }));
  const [kind, setKind] = useState<"slack" | "discord">("slack");
  if (!status.data || !wf.data) return <p className="text-muted">Loading…</p>;
  const gh = wf.data.settings.github ?? {};
  const statuses = wf.data.statuses.map((s) => s.status);
  // Mirrors githubTransitions() defaults on the server.
  const autoName = (rule: "branch" | "opened" | "merged") =>
    (rule === "branch"
      ? statuses.find((s) => s.category === "in_progress")
      : rule === "opened"
        ? statuses.find((s) => s.category === "in_progress" && /review/i.test(s.name))
        : statuses.find((s) => s.category === "done")
    )?.name ?? "don’t move";

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-1 font-semibold">Chat channels</h2>
        <p className="mb-3 text-[13px] text-muted">Post this project’s updates to Slack or Discord.</p>
        <ul className="mb-3 divide-y divide-line card empty:hidden">
          {channels.data?.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="font-medium capitalize">{c.kind}</span>
              <span className="font-mono text-[12px] text-muted">{c.target}</span>
              <span className="text-muted">{c.events.map((e) => EVENTS.find(([v]) => v === e)?.[1]).join(", ")}</span>
              <Button size="sm" variant="ghost" className="ml-auto" aria-label="Disconnect" onClick={() => remove.mutate({ id: c.id })}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const events = EVENTS.map(([v]) => v).filter((v) => f.get(v));
            if (!events.length) return toast.error("Pick at least one kind of update.");
            add.mutate({ projectId, kind, target: String(f.get("target")), events });
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-32" aria-label="Chat app">
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
            </Select>
            <Input
              name="target"
              required
              className="w-96 max-w-full"
              placeholder={kind === "slack" ? "Channel ID, e.g. C04ABCDEF" : "Discord webhook URL"}
              aria-label={kind === "slack" ? "Slack channel ID" : "Discord webhook URL"}
              disabled={kind === "slack" && !status.data.slack}
            />
            <Button variant="primary" disabled={add.isPending || (kind === "slack" && !status.data.slack)}>
              Connect
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-[13px]">
            {EVENTS.map(([v, l]) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="checkbox" name={v} defaultChecked={v !== "commented"} /> {l}
              </label>
            ))}
          </div>
          {kind === "slack" && !status.data.slack && (
            <Off>
              Slack isn’t connected yet. An admin can connect it on the <a href="/settings/integrations" className="text-accent underline">Integrations page</a>.
            </Off>
          )}
        </form>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">GitHub</h2>
        <p className="mb-3 text-[13px] text-muted">
          Branches, commits and pull requests that mention <span className="font-mono">{projectKey}-123</span> link to that issue automatically.
        </p>
        {!status.data.github ? (
          <Off>
            GitHub isn’t connected yet. Connect it on the <a href="/settings/integrations" className="text-accent underline">Integrations page</a>, then come back to choose how issues move.
          </Off>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const repos = String(f.get("repos"))
                .split(/[\s,]+/)
                .map((r) => r.trim())
                .filter(Boolean);
              // "auto" = leave unset (sensible default), "off" = never move, otherwise a status id.
              const rule = (name: string) => {
                const v = String(f.get(name));
                return v === "auto" ? undefined : v === "off" ? null : v;
              };
              const github: Record<string, unknown> = { repos, autoAssign: f.get("autoAssign") === "on" };
              for (const [k, n] of [
                ["onBranchCreated", "branch"],
                ["onPrOpened", "opened"],
                ["onPrMerged", "merged"],
              ] as const) {
                const v = rule(n);
                if (v !== undefined) github[k] = v;
              }
              saveGh.mutate({ projectId, settings: { github } });
            }}
          >
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">Repositories (owner/name). Leave empty to accept any repo.</span>
              <Input name="repos" defaultValue={gh.repos?.join(", ") ?? ""} placeholder="acme/web, acme/api" />
            </label>
            <div>
              <div className="mb-1.5 text-[13px] font-medium">Move issues automatically</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ["branch", "When a branch is created", gh.onBranchCreated, `e.g. ${projectKey.toLowerCase()}-12-fix-login`],
                    ["opened", "When a pull request opens", gh.onPrOpened, "Title, body or branch mentions the key"],
                    ["merged", "When the pull request merges", gh.onPrMerged, "Closing without merging does nothing"],
                  ] as const
                ).map(([name, label, value, hint]) => (
                  <label key={name} className="rounded-lg border border-line bg-surface p-2.5">
                    <span className="mb-1 block text-[12px] text-muted">{label}</span>
                    <Select name={name} defaultValue={value === undefined ? "auto" : value === null ? "off" : value} aria-label={label}>
                      <option value="auto">Automatic ({autoName(name)})</option>
                      <option value="off">Don’t move</option>
                      {statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                    <span className="mt-1 block text-[11px] text-muted">{hint}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] text-muted">Issues only move forward, so a late push never reopens finished work. Your workflow’s transition rules still apply.</p>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="autoAssign" defaultChecked={gh.autoAssign !== false} />
              Assign the issue to the developer who starts it (if it’s unassigned and they’ve linked their GitHub username in Your settings)
            </label>
            <Button variant="primary">Save</Button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Email to issue</h2>
        {status.data.inboundEmail && status.data.inboundDomain ? (
          <p className="text-[13px]">
            Send email to <span className="font-mono">{projectKey.toLowerCase()}@{status.data.inboundDomain}</span>. It lands in Triage. Replies to notification emails become comments.
          </p>
        ) : (
          <Off>
            Email-to-issue isn’t set up. Turn it on under Email on the <a href="/settings/integrations" className="text-accent underline">Integrations page</a>.
          </Off>
        )}
      </section>
    </div>
  );
}
