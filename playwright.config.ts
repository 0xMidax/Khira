import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Fresh embedded DB per run (with demo seed); `pnpm e2e` builds into .next-e2e first.
    command: `rm -rf .pglite-e2e .e2e-outbox.jsonl && drizzle-kit migrate && tsx scripts/seed-demo.mts && next start -p ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "pglite://.pglite-e2e",
      NEXT_DIST_DIR: ".next-e2e",
      BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-123",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      ALLOWED_SIGNUPS: "khira.test",
      EMAIL_OUTBOX_FILE: ".e2e-outbox.jsonl",
    },
  },
});
