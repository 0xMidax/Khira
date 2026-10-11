/**
 * Local demo data: a verified admin login plus a sample project.
 * Usage (stop `pnpm dev` first — PGlite allows one process): pnpm db:seed-demo
 * Safe to re-run: resets the demo password and skips existing data.
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/server/db/index.ts";
import { account, project, user, workflowStatus } from "../src/server/db/schema.ts";
import { createIssue } from "../src/server/services/issues.ts";

const EMAIL = "demo@khira.test";
const PASSWORD = "KhiraDemo#2026";

if (process.env.VERCEL || process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");

const id = "demo-user";
const password = await hashPassword(PASSWORD);
await db.transaction(async (tx) => {
  await tx
    .insert(user)
    .values({ id, name: "Demo User", email: EMAIL, emailVerified: true, role: "admin" })
    .onConflictDoUpdate({ target: user.email, set: { emailVerified: true, role: "admin" } });
  const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
  const [acc] = await tx.select({ id: account.id }).from(account).where(eq(account.userId, u.id));
  if (acc) await tx.update(account).set({ password }).where(eq(account.id, acc.id));
  else await tx.insert(account).values({ id: `${u.id}-credential`, accountId: u.id, providerId: "credential", userId: u.id, password });

  const [existing] = await tx.select({ id: project.id }).from(project).where(eq(project.key, "DEMO"));
  if (existing) return;
  const [p] = await tx.insert(project).values({ key: "DEMO", name: "Demo Project", leadId: u.id }).returning();
  const statuses = await tx
    .insert(workflowStatus)
    .values([
      { projectId: p.id, name: "To Do", category: "todo" as const, color: "slate", position: 0 },
      { projectId: p.id, name: "In Progress", category: "in_progress" as const, color: "blue", position: 1 },
      { projectId: p.id, name: "In Review", category: "in_progress" as const, color: "violet", position: 2 },
      { projectId: p.id, name: "Testing", category: "in_progress" as const, color: "amber", position: 3 },
      { projectId: p.id, name: "Done", category: "done" as const, color: "green", position: 4 },
    ])
    .returning();
  const [todo, doing, review, , done] = statuses;
  const epic = await createIssue(tx, u.id, { projectId: p.id, title: "Launch v1 of the mobile app", type: "epic", priority: "high", assigneeId: u.id });
  const seed: [string, "bug" | "story" | "task", "urgent" | "high" | "medium" | "low", string][] = [
    ["Login fails when password has a space", "bug", "urgent", doing.id],
    ["Onboarding screens", "story", "high", todo.id],
    ["Push notification opt-in", "story", "medium", todo.id],
    ["Set up crash reporting", "task", "medium", review.id],
    ["Write privacy policy page", "task", "low", done.id],
  ];
  for (const [title, type, priority, statusId] of seed)
    await createIssue(tx, u.id, { projectId: p.id, title, type, priority, statusId, parentId: type === "bug" ? null : epic.id, assigneeId: u.id });
});

console.log(`Demo login ready → ${EMAIL} / ${PASSWORD}`);
process.exit(0);
