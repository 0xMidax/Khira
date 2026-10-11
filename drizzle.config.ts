import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL || "pglite://.pglite";
const isPglite = url.startsWith("pglite://");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  ...(isPglite
    ? { driver: "pglite", dbCredentials: { url: url.slice("pglite://".length) || ".pglite" } }
    : { dbCredentials: { url } }),
});
