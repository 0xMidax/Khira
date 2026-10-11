"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Rocket, Sparkles } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { RichText } from "@/components/mention-textarea";
import { useShell } from "@/components/shell";
import { Button, cn, field, Input, IssueKey, TypeIcon } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

export default function Releases({ params }: { params: Promise<{ key: string }> }) {
  const key = use(params).key.toUpperCase();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const project = useQuery(trpc.project.byKey.queryOptions({ key }));
  const pid = project.data?.id ?? "00000000-0000-0000-0000-000000000000";
  const list = useQuery({ ...trpc.release.list.queryOptions({ projectId: pid }), enabled: !!project.data });
  const [openId, setOpenId] = useState<string | null>(null);
  const create = useMutation(trpc.release.save.mutationOptions({ onSuccess: (r) => (qc.invalidateQueries({ queryKey: trpc.release.pathKey() }), setOpenId(r.id)) }));
  if (!project.data) return <p className="p-8 text-muted">Loading…</p>;
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:px-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside>
        <Link href={`/p/${key}`} className="font-mono text-[12px] text-muted hover:text-ink">
          {key}
        </Link>
        <h1 className="mb-4 text-2xl font-semibold">Releases</h1>
        <ul className="mb-4 space-y-1">
          {list.data?.map(({ release: r, total, done }) => (
            <li key={r.id}>
              <button onClick={() => setOpenId(r.id)} className={cn("w-full rounded-md px-3 py-2 text-left hover:bg-sunken", openId === r.id && "bg-sunken")}>
                <span className="flex items-center gap-2 font-medium">
                  {r.name}
                  {r.releasedAt && <span className="rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">Released</span>}
                </span>
                <span className="text-[12px] text-muted">
                  {done}/{total} done{r.releaseDate ? ` · target ${r.releaseDate}` : ""}
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line" aria-hidden>
                  <span className="block h-full bg-accent" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {me.role !== "guest" && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              create.mutate({ projectId: pid, name: String(f.get("name")), releaseDate: (f.get("date") as string) || null });
              e.currentTarget.reset();
            }}
          >
            <Input name="name" placeholder="Version, e.g. v1.4" required maxLength={60} aria-label="Release name" />
            <Input name="date" type="date" aria-label="Target date" />
            <Button className="w-full">New release</Button>
          </form>
        )}
      </aside>
      <section className="min-w-0">{openId ? <ReleaseDetail id={openId} /> : <p className="py-12 text-center text-muted">Pick a release, or create one and assign issues to it from their Release field.</p>}</section>
    </main>
  );
}

function ReleaseDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const r = useQuery(trpc.release.get.queryOptions({ id }));
  const ai = useQuery(trpc.ai.status.queryOptions());
  const [notes, setNotes] = useState("");
  useEffect(() => setNotes(r.data?.notes ?? ""), [r.data?.notes]);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.release.pathKey() });
  const setNotesM = useMutation(trpc.release.setNotes.mutationOptions({ onSuccess: () => (refresh(), toast.success("Notes saved")) }));
  const gen = useMutation(trpc.ai.releaseNotes.mutationOptions({ onSuccess: (n) => setNotes(n) }));
  const ship = useMutation(trpc.release.ship.mutationOptions({ onSuccess: () => (refresh(), toast.success("Released 🎉")) }));
  const pub = useMutation(trpc.release.setPublic.mutationOptions({ onSuccess: refresh }));
  if (!r.data) return <p className="text-muted">Loading…</p>;
  const rel = r.data;
  const open = rel.issues.filter((i) => i.statusCategory !== "done").length;
  const publicUrl = rel.publicSlug ? `${location.origin}/changelog/${rel.publicSlug}` : null;
  const canEdit = me.role !== "guest";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-semibold">{rel.name}</h2>
        {canEdit && !rel.releasedAt && (
          <Button variant="primary" onClick={() => (open === 0 || confirm(`${open} issues aren't done. Release anyway?`)) && ship.mutate({ id, publish: false })}>
            <Rocket size={14} /> Release
          </Button>
        )}
        {canEdit && (
          <label className="flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={!!rel.publicSlug} onChange={(e) => pub.mutate({ id, public: e.target.checked })} /> Public changelog page
          </label>
        )}
        {publicUrl && (
          <a href={publicUrl} target="_blank" rel="noopener" className="flex items-center gap-1 text-[13px] text-accent hover:underline">
            Open <ExternalLink size={12} />
          </a>
        )}
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface empty:hidden">
        {rel.issues.map((i) => (
          <li key={i.id}>
            <Link href={`/i/${i.key}`} className="flex items-center gap-2 px-3 py-2 hover:bg-sunken">
              <TypeIcon type={i.type} size={14} />
              <IssueKey k={i.key} />
              <span className={cn("flex-1 truncate", i.statusCategory === "done" && "text-muted line-through")}>{i.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="font-semibold">Release notes</h3>
          {canEdit && (
            <Button size="sm" className="ml-auto" disabled={gen.isPending} onClick={() => gen.mutate({ releaseId: id })}>
              <Sparkles size={13} /> {gen.isPending ? "Writing…" : ai.data?.enabled ? "Write with AI" : "Draft from issues"}
            </Button>
          )}
        </div>
        {canEdit ? (
          <>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={12} className={cn(field, "font-mono text-[13px]")} aria-label="Release notes (Markdown)" />
            <Button size="sm" variant="primary" className="mt-2" onClick={() => setNotesM.mutate({ id, notes })}>
              Save notes
            </Button>
          </>
        ) : (
          <RichText body={rel.notes ?? "_No notes yet._"} />
        )}
      </section>
    </div>
  );
}
