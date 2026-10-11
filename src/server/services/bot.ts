import { eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { user, userSettings } from "../db/schema";

export const BOT_ID = "khira-bot";

/** The account external events act as when we can't map them to a person. It has no login. */
export async function ensureBot(db: DB) {
  await db
    .insert(user)
    .values({ id: BOT_ID, name: "Khira", email: "bot@khira.invalid", emailVerified: false, role: "member" })
    .onConflictDoNothing();
  return BOT_ID;
}

export async function userByEmail(db: DB, email: string) {
  const [u] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(sql`lower(${user.email})`, email.trim().toLowerCase()));
  return u ?? null;
}

export async function userBySetting(db: DB, field: "slackUserId" | "githubLogin", value: string) {
  const [u] = await db
    .select({ id: userSettings.userId })
    .from(userSettings)
    .where(eq(sql`lower(${userSettings[field]})`, value.toLowerCase()));
  return u?.id ?? null;
}
