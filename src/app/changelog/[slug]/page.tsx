import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { db } from "@/server/db";
import { project, release } from "@/server/db/schema";

async function load(slug: string) {
  if (!/^[\w-]{6,40}$/.test(slug)) return null;
  const [r] = await db
    .select({ name: release.name, notes: release.notes, releasedAt: release.releasedAt, projectName: project.name })
    .from(release)
    .innerJoin(project, eq(project.id, release.projectId))
    .where(eq(release.publicSlug, slug));
  return r ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await load((await params).slug);
  return r ? { title: `${r.projectName} ${r.name}`, robots: { index: false } } : {};
}

/** Public, read-only release notes. Only releases explicitly marked public have a slug. */
export default async function Changelog({ params }: { params: Promise<{ slug: string }> }) {
  const r = await load((await params).slug);
  if (!r) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-[13px] text-muted">{r.projectName}</p>
      <h1 className="mb-1 text-3xl font-semibold">{r.name}</h1>
      {r.releasedAt && <p className="mb-8 text-muted">Released {r.releasedAt.toLocaleDateString(undefined, { dateStyle: "long" })}</p>}
      <article className="prose-khira">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ href, children }) => <a href={href} rel="noopener noreferrer nofollow" className="text-accent underline">{children}</a> }}>
          {(r.notes ?? "").replace(/\(([A-Z][A-Z0-9]*-\d+)\)/g, "")}
        </ReactMarkdown>
      </article>
    </main>
  );
}
