import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const url = process.env.DATABASE_URL ?? "pglite://.pglite";
if (!process.env.DATABASE_URL && process.env.VERCEL) throw new Error("DATABASE_URL is required in deployed environments.");

// Neon/any Postgres in prod; embedded PGlite (WASM Postgres) for local dev when no server is around.
async function create(): Promise<DB> {
  if (url.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir = url.slice("pglite://".length);
    // Same query builder API; only the driver differs.
    return drizzle(new PGlite(dir || undefined), { schema, casing: "snake_case" }) as unknown as DB;
  }
  return drizzlePg(postgres(url, { max: 5, prepare: false }), { schema, casing: "snake_case" });
}

const g = globalThis as unknown as { __khiraDb?: Promise<DB> };
export const dbPromise = (g.__khiraDb ??= create());
export const db = await dbPromise;
export { schema };
