"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useShell } from "@/components/shell";
import { Button, Input } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

export default function Projects() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const { me } = useShell();
  const list = useQuery(trpc.project.list.queryOptions());
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [method, setMethod] = useState<"kanban" | "scrum">("kanban");
  const create = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: (p) => {
        qc.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
        router.push(`/p/${p.key}`);
      },
    }),
  );
  const suggestKey = (n: string) => n.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 4) || n.slice(0, 3).toUpperCase();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <h1 className="mb-6 text-2xl font-semibold">Projects</h1>
      <ul className="mb-10 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface empty:hidden">
        {list.data?.map((p) => (
          <li key={p.id}>
            <Link href={`/p/${p.key}`} className="flex items-center gap-4 px-4 py-3 hover:bg-sunken">
              <span className="w-14 font-mono text-[12px] text-muted">{p.key}</span>
              <span className="flex-1">
                <span className="block font-medium">{p.name}</span>
                {p.description && <span className="block truncate text-[13px] text-muted">{p.description}</span>}
              </span>
              <span className="text-[13px] text-muted">{p.openIssues} open</span>
            </Link>
          </li>
        ))}
      </ul>

      {me.role !== "guest" && (
        <section>
          <h2 className="mb-1 font-semibold">New project</h2>
          <p className="mb-3 text-[13px] text-muted">The key prefixes every issue number, like {key || "KHR"}-1. It can’t be changed later.</p>
          <div role="radiogroup" aria-label="How does this team work?" className="mb-3 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["kanban", "Kanban", "One continuous board. Pull work as you have capacity. Best for support, ops and steady flow."],
                ["scrum", "Scrum", "Plan work in sprints from a backlog, with burndown, velocity and retros."],
              ] as const
            ).map(([v, label, help]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={method === v}
                onClick={() => setMethod(v)}
                className={
                  "rounded-xl border p-3 text-left transition-colors " +
                  (method === v ? "border-accent bg-accent-soft ring-2 ring-accent/20" : "border-line bg-surface hover:bg-sunken")
                }
              >
                <span className="block font-[family-name:var(--font-display)] font-semibold">{label}</span>
                <span className="block text-[13px] text-muted">{help}</span>
              </button>
            ))}
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ name, key, method });
            }}
          >
            <Input
              value={name}
              required
              maxLength={80}
              placeholder="Project name"
              className="w-64"
              aria-label="Project name"
              onChange={(e) => {
                setName(e.target.value);
                if (!keyTouched) setKey(suggestKey(e.target.value));
              }}
            />
            <Input
              value={key}
              required
              pattern="[A-Za-z][A-Za-z0-9]{1,9}"
              title="2–10 letters or digits, starting with a letter"
              placeholder="KEY"
              className="w-28 font-mono uppercase"
              aria-label="Project key"
              onChange={(e) => (setKeyTouched(true), setKey(e.target.value.toUpperCase()))}
            />
            <Button variant="primary" disabled={create.isPending}>
              Create project
            </Button>
          </form>
        </section>
      )}
    </main>
  );
}
