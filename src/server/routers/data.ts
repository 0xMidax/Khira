import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { mapHeader, mapPriority, mapType, parseCsv, parseLooseDate } from "@/lib/csv";
import { label, user, workflowStatus } from "../db/schema";
import { BOT_ID } from "../services/bot";
import { createIssue, write } from "../services/issues";
import { memberProcedure, router } from "../trpc";

const MAX_ROWS = 2000;

export const dataRouter = router({
  /** Dry run: headers we understood, row count, and the first rows mapped. */
  previewCsv: memberProcedure.input(z.object({ csv: z.string().max(5_000_000) })).mutation(({ input }) => {
    const rows = parseCsv(input.csv);
    if (rows.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "The file needs a header row and at least one issue." });
    const header = rows[0];
    return {
      columns: header.map((h) => ({ header: h, field: mapHeader(h) })),
      rows: rows.length - 1,
      sample: rows.slice(1, 6),
    };
  }),

  importCsv: memberProcedure.input(z.object({ projectId: z.string().uuid(), csv: z.string().max(5_000_000) })).mutation(async ({ ctx, input }) => {
    const rows = parseCsv(input.csv);
    if (rows.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "The file needs a header row and at least one issue." });
    if (rows.length - 1 > MAX_ROWS) throw new TRPCError({ code: "BAD_REQUEST", message: `Import up to ${MAX_ROWS} issues at a time.` });
    const fields = rows[0].map(mapHeader);
    if (!fields.includes("title")) throw new TRPCError({ code: "BAD_REQUEST", message: "No Summary or Title column found." });

    const [statuses, people, existingLabels] = await Promise.all([
      ctx.db.select().from(workflowStatus).where(eq(workflowStatus.projectId, input.projectId)).orderBy(asc(workflowStatus.position)),
      ctx.db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(sql`${user.id} <> ${BOT_ID}`),
      ctx.db.select().from(label).where(eq(label.projectId, input.projectId)),
    ]);
    const labelIds = new Map(existingLabels.map((l) => [l.name.toLowerCase(), l.id]));
    const errors: { row: number; message: string }[] = [];
    let created = 0;

    // One transaction for the whole file: either everything valid lands, or nothing does.
    await write(ctx.db, async (tx) => {
      for (let r = 1; r < rows.length; r++) {
        const get = (f: string) => {
          const i = fields.indexOf(f);
          return i >= 0 ? (rows[r][i] ?? "").trim() : "";
        };
        const title = get("title");
        if (!title) {
          errors.push({ row: r + 1, message: "Missing title" });
          continue;
        }
        const statusName = get("status").toLowerCase();
        const status = statuses.find((s) => s.name.toLowerCase() === statusName) ?? (statusName === "done" || statusName === "closed" ? statuses.find((s) => s.category === "done") : undefined);
        const who = get("assignee").toLowerCase();
        const assignee = who ? people.find((p) => p.email.toLowerCase() === who || p.name.toLowerCase() === who) : undefined;
        const names = get("labels")
          .split(/[,\s]+/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 20);
        const ids: string[] = [];
        for (const n of names) {
          let lid = labelIds.get(n.toLowerCase());
          if (!lid) {
            const [l] = await tx.insert(label).values({ projectId: input.projectId, name: n.slice(0, 40) }).returning();
            lid = l.id;
            labelIds.set(n.toLowerCase(), lid);
          }
          ids.push(lid);
        }
        const est = Number(get("estimate"));
        await createIssue(tx, ctx.user.id, {
          projectId: input.projectId,
          title: title.slice(0, 255),
          description: get("description").slice(0, 50_000),
          type: mapType(get("type")),
          priority: mapPriority(get("priority")),
          statusId: status?.id,
          assigneeId: assignee?.id ?? null,
          dueDate: parseLooseDate(get("dueDate")),
          estimate: Number.isFinite(est) && est > 0 ? Math.min(1000, Math.round(est)) : null,
          labelIds: [...new Set(ids)],
        }, "import");
        created++;
      }
    });
    return { created, errors };
  }),
});
