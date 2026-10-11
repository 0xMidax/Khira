import { expect, type Page, test } from "@playwright/test";

// Uses the seeded demo admin (scripts/seed-demo.mts runs before the server starts).
async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("demo@khira.test");
  await page.getByLabel("Password").fill("KhiraDemo#2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Good to see you/ })).toBeVisible();
}

test("sprint planning, search, reports, retro and settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && /Content Security Policy|Refused to/.test(m.text()) && errors.push(m.text()));
  await signIn(page);

  // Backlog: create a sprint, put an issue in it via the issue panel, start it
  await page.goto("/p/DEMO?view=backlog");
  await page.getByRole("button", { name: "Create sprint" }).click();
  await expect(page.getByRole("heading", { name: "DEMO Sprint 1" })).toBeVisible();
  await page.getByText("Onboarding screens").click();
  const panel = page.getByRole("dialog", { name: /DEMO-/ });
  await panel.getByLabel("Sprint").selectOption({ label: "DEMO Sprint 1" });
  await expect(page.getByText("Updated")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Start sprint" }).click();
  await page.getByRole("dialog", { name: /Start DEMO Sprint 1/ }).getByLabel("Sprint goal").fill("Ship onboarding");
  await page.getByRole("dialog", { name: /Start DEMO Sprint 1/ }).getByRole("button", { name: "Start sprint" }).click();
  await expect(page.getByText("DEMO Sprint 1 started")).toBeVisible();

  // Board is scoped to the active sprint
  await page.goto("/p/DEMO");
  await expect(page.getByText("Sprint goal: Ship onboarding")).toBeVisible();
  await expect(page.getByRole("region", { name: "To Do" }).getByText("Onboarding screens")).toBeVisible();
  await expect(page.getByText("Push notification opt-in")).toHaveCount(0);

  // Complete it; unfinished work goes back to the backlog
  await page.goto("/p/DEMO?view=backlog");
  await page.getByRole("button", { name: "Complete sprint" }).click();
  await page.getByRole("dialog", { name: /Complete DEMO Sprint 1/ }).getByLabel("Move unfinished issues to").selectOption({ label: "Backlog" });
  await page.getByRole("dialog", { name: /Complete DEMO Sprint 1/ }).getByRole("button", { name: "Complete sprint" }).click();
  await expect(page.getByText(/completed · 1 carried over/)).toBeVisible();

  // Reports render charts
  await page.goto("/p/DEMO/reports");
  await expect(page.getByRole("heading", { name: "Cumulative flow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Velocity" })).toBeVisible();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();

  // Retro: add an action and turn it into an issue
  await page.goto("/p/DEMO/retro");
  await page.getByLabel("Add to Actions").fill("Automate the release checklist");
  await page.getByLabel("Add to Actions").press("Enter");
  await page.getByRole("button", { name: "Make issue" }).click();
  await expect(page.getByText(/DEMO-\d+/).last()).toBeVisible();

  // Workflow settings: add a WIP limit and see it on the board
  await page.goto("/p/DEMO/settings");
  await page.getByRole("tab", { name: "Workflow" }).click();
  await page.getByLabel("WIP limit").nth(1).fill("1");
  await page.getByLabel("WIP limit").nth(1).blur();
  await page.waitForTimeout(500);
  await page.goto("/p/DEMO?scope=all");
  await expect(page.getByRole("region", { name: "In Progress" }).getByText("1 / 1")).toBeVisible();

  // Dashboards: create one with default widgets
  await page.goto("/dashboards");
  await page.getByLabel("Dashboard name").fill("Team overview");
  await page.getByRole("button", { name: "Create dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Open work by status" })).toBeVisible();

  // Timeline and calendar load
  await page.goto("/timeline");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await page.goto("/calendar");
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("guests can read but not write", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin);
  // A guest signs up (allowed domain), verifies, and gets demoted by the admin.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto("/sign-in");
  await guest.getByRole("button", { name: "Create an account" }).click();
  await guest.getByLabel("Name").fill("Gus");
  await guest.getByLabel("Email").fill("gus@khira.test");
  await guest.getByLabel("Password").fill("correct-horse-battery");
  await guest.getByRole("button", { name: "Create account" }).click();
  await expect(guest.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const { readFileSync } = await import("node:fs");
  const link = readFileSync(".e2e-outbox.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.to === "gus@khira.test").at(-1).text.match(/https?:\S+/)[0];
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: /Good to see you, Gus/ })).toBeVisible();

  await admin.goto("/settings/team");
  await admin.getByLabel("Role for Gus").selectOption("guest");
  await expect(admin.getByText("Role updated")).toBeVisible();

  await guest.goto("/p/DEMO");
  await expect(guest.getByRole("region", { name: "To Do" })).toBeVisible();
  await guest.getByText("Write privacy policy page").click();
  await expect(guest.getByLabel("New comment")).toHaveCount(0);
  await expect(guest.getByLabel("Status")).toBeDisabled();
});

test("the guided tour walks through the app", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Take the tour" }).click();
  const card = page.getByRole("dialog", { name: "Welcome to Khira" });
  await expect(card).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Capture work as issues" })).toBeVisible();
  // Walk to the project board steps; the tour navigates by itself.
  // Capture → search → my work → team board → inbox → triage → projects → views → board
  for (let n = 0; n < 8; n++) await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/p\/DEMO/);
  await expect(page.getByRole("dialog", { name: "Move work across the board" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Move work/ })).toHaveCount(0);
  // Finished once: the "new" dot is gone.
  await expect(page.getByRole("button", { name: "Take the tour" }).getByLabel("New")).toHaveCount(0);
});
