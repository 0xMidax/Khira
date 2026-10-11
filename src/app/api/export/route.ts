import { TRPCError } from "@trpc/server";
import { toCsv } from "@/lib/csv";
import { getSession } from "@/server/auth";
import { db } from "@/server/db";
import { runKql } from "@/server/routers/agile";
import { exportAll } from "@/server/services/backup";

/** GET /api/export?kql=…  → CSV of matching issues.  GET /api/export?full=1 → JSON backup (admins). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s?.user.emailVerified) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const stamp = new Date().toISOString().slice(0, 10);
  if (url.searchParams.get("full")) {
    if (s.user.role !== "admin") return new Response("Admins only", { status: 403 });
    return new Response(JSON.stringify(await exportAll(db)), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="khira-backup-${stamp}.json"` },
    });
  }
  try {
    const rows = await runKql(db, url.searchParams.get("kql") ?? "", s.user.id, 10_000);
    const csv = toCsv(
      ["Key", "Title", "Type", "Status", "Priority", "Assignee", "Estimate", "Due", "Created", "Resolved"],
      rows.map((r) => [r.key, r.title, r.type, r.statusName, r.priority, r.assigneeName ?? "", r.estimate ?? "", r.dueDate ?? "", r.createdAt, r.resolvedAt ?? ""]),
    );
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="khira-issues-${stamp}.csv"` } });
  } catch (e) {
    if (e instanceof TRPCError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
