import { migrate } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { db } from "@/server/db";

await migrate(db as unknown as PgliteDatabase, { migrationsFolder: "./drizzle" });
