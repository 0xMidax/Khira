import { getTableName, type Table } from "drizzle-orm";
import type { DB } from "../db";
import * as schema from "../db/schema";
import { putObject } from "../storage";

// Auth secrets never leave the database in a backup.
const SKIP = new Set(["session", "account", "verification", "api_token", "push_subscription"]);

export async function exportAll(db: DB) {
  const out: Record<string, unknown[]> = {};
  for (const t of Object.values(schema)) {
    if (!t || typeof t !== "object" || !(Symbol.for("drizzle:IsDrizzleTable") in t)) continue;
    const name = getTableName(t as Table);
    if (SKIP.has(name)) continue;
    out[name] = await db.select().from(t as Table);
  }
  return { exportedAt: new Date().toISOString(), version: 1, tables: out };
}

/** Nightly JSON snapshot to the storage bucket (Neon point-in-time restore is the primary backup). */
export async function nightlyBackup(db: DB, now = new Date()) {
  const data = await exportAll(db);
  const key = `backups/khira-${now.toISOString().slice(0, 10)}.json`;
  await putObject(key, JSON.stringify(data), "application/json");
  return { key, tables: Object.keys(data.tables).length };
}
