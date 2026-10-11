import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    env: { DATABASE_URL: "pglite://" }, // in-memory Postgres per test file
    setupFiles: ["./src/test/setup.ts"],
    server: { deps: { inline: ["server-only"] } },
    alias: { "server-only": new URL("./src/test/empty.ts", import.meta.url).pathname },
  },
});
