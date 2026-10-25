import { and, eq, isNull } from "drizzle-orm";
import { sha256 } from "@/lib/crypto";
import { db } from "./db";
import { apiToken, user } from "./db/schema";

/** Resolves `Authorization: Bearer khira_…` (Your settings → API tokens) to its active owner, or null. Used by /api/v1 and /api/mcp. */
export async function authenticate(req: Request) {
  const raw = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!raw.startsWith("khira_")) return null;
  const [row] = await db
    .select({ tokenId: apiToken.id, id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified })
    .from(apiToken)
    .innerJoin(user, eq(user.id, apiToken.userId))
    .where(and(eq(apiToken.hash, sha256(raw)), isNull(apiToken.revokedAt), isNull(user.deactivatedAt)));
  if (!row) return null;
  void db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, row.tokenId)).catch(() => {});
  return row;
}
