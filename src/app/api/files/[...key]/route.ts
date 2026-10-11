import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { loadAccess } from "@/server/access";
import { attachment, issue } from "@/server/db/schema";
import { getMember } from "@/server/auth";
import { inlineSafe, MAX_UPLOAD_BYTES, readLocal, usingS3, writeLocal } from "@/server/storage";

// Local-disk storage for development (and single-server installs). With S3/R2 configured, browsers talk to the bucket directly.

const member = getMember;

export async function PUT(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (usingS3) return new Response("Not found", { status: 404 });
  const u = await member();
  if (!u || u.role === "guest") return new Response("Unauthorized", { status: 401 });
  const storageKey = (await params).key.join("/");
  const [a] = await db
    .select()
    .from(attachment)
    .where(and(eq(attachment.storageKey, storageKey), eq(attachment.uploaderId, u.id), eq(attachment.uploaded, false)));
  if (!a) return new Response("Unknown upload", { status: 404 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES || len > a.size) return new Response("Too large", { status: 413 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_UPLOAD_BYTES || buf.length > a.size) return new Response("Too large", { status: 413 });
  await writeLocal(storageKey, buf);
  return new Response(null, { status: 204 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (usingS3) return new Response("Not found", { status: 404 });
  const me = await member();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const storageKey = (await params).key.join("/");
  const [a] = await db.select().from(attachment).where(and(eq(attachment.storageKey, storageKey), eq(attachment.uploaded, true)));
  if (!a) return new Response("Not found", { status: 404 });
  // Files of private projects are only for people who can see that project.
  const [i] = await db.select({ projectId: issue.projectId }).from(issue).where(eq(issue.id, a.issueId));
  if (!i || !(await loadAccess(db, me)).roleIn(i.projectId)) return new Response("Not found", { status: 404 });
  const data = await readLocal(storageKey);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": a.mime,
      "Content-Disposition": `${inlineSafe(a.mime) ? "inline" : "attachment"}; filename="${a.name.replace(/["\\\r\n]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=300",
    },
  });
}
