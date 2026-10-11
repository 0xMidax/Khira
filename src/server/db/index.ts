import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const url = process.env.DATABASE_URL || "pglite://.pglite";
// The embedded database is for local development only. Builds may run without a database; a running production server may not.
if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build")
  throw new Error("DATABASE_URL is required in production. Point it at your Postgres database.");

// Neon/any Postgres in prod; embedded PGlite (WASM Postgres) for local dev when no server is around.
async function create(): Promise<DB> {
  if (url.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir = url.slice("pglite://".length);
    const pg = new PGlite(dir || undefined);
    // PGlite's files corrupt if the process dies mid-write: close it cleanly on Ctrl+C / kill.
    if (dir) {
      const shutdown = (signal: NodeJS.Signals) => {
        pg.close().finally(() => process.kill(process.pid, signal));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
    // Same query builder API; only the driver differs.
    return drizzle(pg, { schema, casing: "snake_case" }) as unknown as DB;
  }
  return drizzlePg(postgres(url, { max: 5, prepare: false }), { schema, casing: "snake_case" });
}

const g = globalThis as unknown as { __khiraDb?: Promise<DB> };
export const dbPromise = (g.__khiraDb ??= create());
export const db = await dbPromise;
export { schema };
