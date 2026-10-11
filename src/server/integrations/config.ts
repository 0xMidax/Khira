import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "../db";
import { workspaceIntegration } from "../db/schema";

/**
 * Integration settings come from the Integrations page (stored encrypted) and fall back to env vars,
 * so existing .env setups keep working. Cached briefly because webhooks and dispatch read them often.
 */
export type IntegrationConfigs = {
  slack: { botToken: string; signingSecret: string; standupChannel: string | null };
  github: { webhookSecret: string };
  email: { resendKey: string | null; from: string | null; inboundSecret: string | null; inboundDomain: string | null };
};
type Kind = keyof IntegrationConfigs;
export type Source = "app" | "env";

const TTL = 15_000;
const cache = new Map<Kind, { at: number; value: { config: IntegrationConfigs[Kind]; source: Source; meta: Record<string, string | null> } | null }>();

function fromEnv<K extends Kind>(kind: K): IntegrationConfigs[K] | null {
  const e = process.env;
  if (kind === "slack")
    return e.SLACK_BOT_TOKEN && e.SLACK_SIGNING_SECRET
      ? ({ botToken: e.SLACK_BOT_TOKEN, signingSecret: e.SLACK_SIGNING_SECRET, standupChannel: e.STANDUP_SLACK_CHANNEL ?? null } as IntegrationConfigs[K])
      : null;
  if (kind === "github") return e.GITHUB_WEBHOOK_SECRET ? ({ webhookSecret: e.GITHUB_WEBHOOK_SECRET } as IntegrationConfigs[K]) : null;
  return e.RESEND_API_KEY || e.INBOUND_EMAIL_SECRET
    ? ({
        resendKey: e.RESEND_API_KEY ?? null,
        from: e.EMAIL_FROM ?? null,
        inboundSecret: e.INBOUND_EMAIL_SECRET ?? null,
        inboundDomain: e.INBOUND_EMAIL_DOMAIN ?? null,
      } as IntegrationConfigs[K])
    : null;
}

export async function getIntegration<K extends Kind>(kind: K): Promise<{ config: IntegrationConfigs[K]; source: Source; meta: Record<string, string | null> } | null> {
  const hit = cache.get(kind);
  if (hit && Date.now() - hit.at < TTL) return hit.value as never;
  let value: { config: IntegrationConfigs[K]; source: Source; meta: Record<string, string | null> } | null = null;
  try {
    const [row] = await db.select().from(workspaceIntegration).where(eq(workspaceIntegration.kind, kind));
    if (row) value = { config: { ...JSON.parse(decrypt(row.secrets)), ...row.meta } as IntegrationConfigs[K], source: "app", meta: row.meta };
  } catch (e) {
    // Table not migrated yet (restart `pnpm dev` to apply) or the key changed: fall back to env, never crash.
    console.warn(`[integrations] ${kind}: ${(e as Error).message.split("\n")[0]}`);
  }
  if (!value) {
    const env = fromEnv(kind);
    value = env ? { config: env, source: "env", meta: {} } : null;
  }
  cache.set(kind, { at: Date.now(), value: value as never });
  return value;
}

export async function getConfig<K extends Kind>(kind: K) {
  return (await getIntegration(kind))?.config ?? null;
}

/** secrets are encrypted; meta (non-secret) stays readable so the page can show it. */
export async function saveIntegration(kind: Kind, secrets: Record<string, string | null>, meta: Record<string, string | null>, userId: string) {
  const row = { kind, secrets: encrypt(JSON.stringify(secrets)), meta, connectedBy: userId, updatedAt: new Date() };
  await db.insert(workspaceIntegration).values(row).onConflictDoUpdate({ target: workspaceIntegration.kind, set: row });
  cache.delete(kind);
}

export async function removeIntegration(kind: Kind) {
  await db.delete(workspaceIntegration).where(eq(workspaceIntegration.kind, kind));
  cache.delete(kind);
}

/** Health info (e.g. last webhook received) without touching secrets. */
export async function touchIntegration(kind: Kind, patch: Record<string, string>) {
  try {
    const [row] = await db.select({ meta: workspaceIntegration.meta }).from(workspaceIntegration).where(eq(workspaceIntegration.kind, kind));
    if (!row) return;
    await db.update(workspaceIntegration).set({ meta: { ...row.meta, ...patch } }).where(eq(workspaceIntegration.kind, kind));
    cache.delete(kind);
  } catch {
    /* health info is best-effort */
  }
}

export const clearIntegrationCache = () => cache.clear();
