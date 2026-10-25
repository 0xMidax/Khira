"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/react";
import { Button, cn } from "./ui";

const CLIENTS = {
  claude: {
    label: "Claude Code",
    hint: "Run once in your terminal:",
    snippet: (url: string, token: string) => `claude mcp add --transport http khira ${url} --header "Authorization: Bearer ${token}"`,
  },
  codex: {
    label: "Codex",
    hint: "Add to ~/.codex/config.toml, and set KHIRA_TOKEN in your shell:",
    snippet: (url: string, token: string) => `[mcp_servers.khira]\nurl = "${url}"\nbearer_token_env_var = "KHIRA_TOKEN"\n\n# in ~/.bashrc or ~/.zshrc\nexport KHIRA_TOKEN=${token}`,
  },
  json: {
    label: "Cursor & others",
    hint: "For tools configured with JSON (Cursor's .cursor/mcp.json, Windsurf, and most others):",
    snippet: (url: string, token: string) => JSON.stringify({ mcpServers: { khira: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
} as const;

/** Setup for coding agents (MCP). Creates a dedicated token and shows a ready-to-paste config with it. */
export function AgentConnect({ large = false }: { large?: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [client, setClient] = useState<keyof typeof CLIENTS>("claude");
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState("https://<your-khira>/api/mcp");
  useEffect(() => setUrl(`${location.origin}/api/mcp`), []);
  const create = useMutation(
    trpc.integration.createToken.mutationOptions({
      onSuccess: (r) => (setToken(r.token), qc.invalidateQueries({ queryKey: trpc.integration.tokens.queryKey() })),
      onError: (e) => toast.error(e.message),
    }),
  );
  const c = CLIENTS[client];
  const text = c.snippet(url, token ?? "<your token>");

  return (
    <section className="space-y-3">
      <h2 className={cn("flex items-center gap-2", large ? "text-xl" : "font-semibold")}>
        <Bot size={17} /> Connect a coding agent
      </h2>
      <p className="text-[13px] text-muted">
        Let Claude Code, Codex, Cursor and other AI coding tools read and update your issues over MCP: find your work, move issues along, and comment with what they changed. The agent acts as you, with your access.
      </p>
      <ol className="grid gap-2 text-[13px] sm:grid-cols-4">
        {[
          ["Pick your tool", "Choose the tab for the agent you use."],
          ["Create a token", "One click. It’s put straight into the snippet."],
          ["Paste the snippet", "Run it, or add it to the config file shown, then restart the agent."],
          ["Ask away", "e.g. “what’s assigned to me in Khira?”"],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-2.5 rounded-xl border border-line bg-surface p-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{i + 1}</span>
            <span>
              <span className="block font-medium">{title}</span>
              <span className="text-muted">{body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="card overflow-hidden">
        <div role="tablist" aria-label="Agent" className="flex gap-1 border-b border-line px-3">
          {(Object.keys(CLIENTS) as (keyof typeof CLIENTS)[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={client === k}
              onClick={() => setClient(k)}
              className={cn("-mb-px border-b-2 px-2 py-2 text-[13px]", client === k ? "border-accent font-semibold" : "border-transparent text-muted hover:text-ink")}
            >
              {CLIENTS[k].label}
            </button>
          ))}
        </div>
        <div className="space-y-2 p-3">
          <p className="text-[13px] text-muted">{c.hint}</p>
          <pre className="overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre">{text}</pre>
          <div className="flex flex-wrap items-center gap-2">
            {!token && (
              <Button variant="primary" size="sm" disabled={create.isPending} onClick={() => create.mutate({ name: `Coding agent (${CLIENTS[client].label})` })}>
                Create a token for this
              </Button>
            )}
            <Button size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}>
              <Copy size={13} /> Copy
            </Button>
            <span className="text-[12px] text-muted">{token ? "The token is shown only now. Revoke it below any time." : "Or paste a token you already have."}</span>
          </div>
        </div>
      </div>
      <p className="text-[12px] text-muted">
        Things to ask: “what’s assigned to me in Khira?”, “start KHR-12 and move it to In Progress”, “create a bug in KHR for the failing login test”, or “comment on KHR-12 with what you changed”.
        Name your branch after the issue (e.g. <code className="font-mono">khr-12-fix-login</code>) and, with GitHub connected, the issue moves along on its own.
        Each teammate connects their own agent, from here or from Your settings, with their own token.
      </p>
    </section>
  );
}
