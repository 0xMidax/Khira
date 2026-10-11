import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { DB } from "../db";
import { invitation, user } from "../db/schema";

const norm = (e: string) => e.trim().toLowerCase();

export async function findValidInvite(db: DB, email: string) {
  const [inv] = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.email, norm(email)), isNull(invitation.acceptedAt), isNull(invitation.revokedAt), gt(invitation.expiresAt, new Date())))
    .orderBy(desc(invitation.createdAt))
    .limit(1);
  return inv ?? null;
}

export async function acceptInvite(db: DB, email: string) {
  await db
    .update(invitation)
    .set({ acceptedAt: new Date() })
    .where(and(eq(invitation.email, norm(email)), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)));
}

export async function emailTaken(db: DB, email: string) {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(sql`lower(${user.email})`, norm(email)));
  return !!u;
}

export { norm as normalizeEmail };
