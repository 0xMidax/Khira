import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const lastLinkFor = (email: string) => {
  const mails = readFileSync(".e2e-outbox.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; text: string });
  return mails.filter((m) => m.to === email).at(-1)!.text.match(/https?:\S+/)![0];
};

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  // Not in yet: the address is unverified.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto(lastLinkFor(email));
  await expect(page.getByRole("heading", { name: new RegExp(`Good to see you, ${name}`) })).toBeVisible();
}

test("core flow: project → issue → board drag → mention → notification", async ({ browser }) => {
  const ann = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  await signUp(ann, "Ann", "ann@khira.test"); // first user → admin
  await signUp(bob, "Bob", "bob@khira.test");

  // Strangers can't join.
  const eve = await (await browser.newContext()).newPage();
  await eve.goto("/sign-in");
  await eve.getByRole("button", { name: "Create an account" }).click();
  await eve.getByLabel("Name").fill("Eve");
  await eve.getByLabel("Email").fill("eve@evil.test");
  await eve.getByLabel("Password").fill("correct-horse-battery");
  await eve.getByRole("button", { name: "Create account" }).click();
  await expect(eve.getByText(/invite-only/)).toBeVisible();

  // Project
  await ann.getByRole("link", { name: "Projects" }).click();
  await ann.getByLabel("Project name").fill("Khira Core");
  await expect(ann.getByLabel("Project key")).toHaveValue("KC");
  await ann.getByRole("button", { name: "Create project" }).click();
  await expect(ann.getByRole("heading", { name: "Khira Core" })).toBeVisible();

  // Issue via keyboard shortcut
  await ann.keyboard.press("c");
  const dialog = ann.getByRole("dialog", { name: "New issue" });
  await dialog.getByPlaceholder("What needs doing?").fill("Fix login redirect");
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(ann.getByText("Created KC-1")).toBeVisible();

  const todo = ann.getByRole("region", { name: "To Do" });
  const doing = ann.getByRole("region", { name: "In Progress" });
  await expect(todo.getByText("Fix login redirect")).toBeVisible();

  // Drag To Do → In Progress, then confirm it persisted
  const card = todo.getByText("Fix login redirect");
  const box = (await card.boundingBox())!;
  const target = (await doing.locator("ol").boundingBox())!;
  await ann.mouse.move(box.x + 20, box.y + 10);
  await ann.mouse.down();
  await ann.mouse.move(box.x + 40, box.y + 20, { steps: 5 });
  await ann.mouse.move(target.x + 60, target.y + 30, { steps: 15 });
  await ann.mouse.up();
  await expect(doing.getByText("Fix login redirect")).toBeVisible();
  await ann.reload();
  await expect(ann.getByRole("region", { name: "In Progress" }).getByText("Fix login redirect")).toBeVisible();

  // Open in the side panel and mention Bob
  await ann.getByRole("region", { name: "In Progress" }).getByText("Fix login redirect").click();
  const panel = ann.getByRole("dialog", { name: "KC-1" });
  const box2 = panel.getByLabel("New comment");
  await box2.fill("@Bo");
  await ann.getByRole("listbox").getByRole("option", { name: /Bob/ }).click();
  await box2.pressSequentially("can you take a look?");
  await panel.getByRole("button", { name: "Comment" }).click();
  await expect(panel.getByText("can you take a look?")).toBeVisible();
  await expect(panel.locator("span", { hasText: "@Bob" }).first()).toBeVisible();

  // Bob gets the notification
  await bob.goto("/inbox");
  await expect(bob.getByText("mentioned you")).toBeVisible();
  await bob.getByText("Fix login redirect").click();
  await expect(bob).toHaveURL(/\/i\/KC-1$/);

  // ⌘K finds the issue by key
  await bob.keyboard.press("Control+k");
  await bob.getByPlaceholder(/Search issues/).fill("KC-1");
  await expect(bob.getByRole("option", { name: /KC-1/ })).toBeVisible();
});

test("demo login from the seed script works", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("demo@khira.test");
  await page.getByLabel("Password").fill("KhiraDemo#2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Good to see you, Demo/ })).toBeVisible();
  await page.goto("/p/DEMO");
  await expect(page.getByRole("region", { name: "In Progress" }).getByText("Login fails when password has a space")).toBeVisible();
  await expect(page.getByRole("link", { name: "Team" })).toBeVisible(); // admin
});
