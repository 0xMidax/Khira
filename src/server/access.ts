import { TRPCError } from "@trpc/server";
import { type AnyColumn, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DB } from "./db";
import { issue, project, projectMember, user } from "./db/schema";

export type ProjectRole = "admin" | "member" | "viewer";
type Who = { id: string; role: string };
type Need = "read" | "write" | "admin";

const RANK: Record<ProjectRole, number> = { viewer: 0, member: 1, admin: 2 };

/**
 * Effective role in a project:
 * - workspace admin → admin everywhere
 * - private project → only its members (by their project role)
 * - open project → project role if set, otherwise derived from the workspace role
 * Workspace guests are always capped at viewer.
 */
export function effectiveRole(who: Who, visibility: "open" | "private", membership: ProjectRole | undefined): ProjectRole | null {
  if (who.role === "admin") return "admin";
  const base: ProjectRole | null = membership ?? (visibility === "open" ? (who.role === "guest" ? "viewer" : "member") : null);
  if (!base) return null;
  return who.role === "guest" ? "viewer" : base;
}

export const allows = (role: ProjectRole | null, need: Need) => !!role && RANK[role] >= RANK[need === "read" ? "viewer" : need === "write" ? "member" : "admin"];

/** Per-request view of what this person can reach. Cheap: one row per project and per membership. */
export async function loadAccess(db: Pick<DB, "select">, who: Who) {
  const [projects, mine] = await Promise.all([
    db.select({ id: project.id, visibility: project.visibility }).from(project),
    db.select({ projectId: projectMember.projectId, role: projectMember.role }).from(projectMember).where(eq(projectMember.userId, who.id)),
  ]);
  const membership = new Map(mine.map((m) => [m.projectId, m.role]));
  const roles = new Map<string, ProjectRole>();
  for (const p of projects) {
    const r = effectiveRole(who, p.visibility, membership.get(p.id));
    if (r) roles.set(p.id, r);
  }
  const everything = roles.size === projects.length;
  return {
    roleIn: (projectId: string) => roles.get(projectId) ?? null,
    /** null = no restriction (can see every project). */
    projectIds: everything ? null : [...roles.keys()],
  };
}
export type Access = Awaited<ReturnType<typeof loadAccess>>;

/** WHERE fragment limiting rows to reachable projects. */
export function scope(access: Access, column: AnyColumn = issue.projectId): SQL | undefined {
  if (!access.projectIds) return undefined;
  return access.projectIds.length ? inArray(column, access.projectIds) : sql`false`;
}

/** Unreachable projects look like they don't exist (no leaking private names); reachable-but-not-allowed is FORBIDDEN. */
export function assertRole(access: Access, projectId: string, need: Need) {
  const role = access.roleIn(projectId);
  if (!role) throw new TRPCError({ code: "NOT_FOUND" });
  if (!allows(role, need))
    throw new TRPCError({ code: "FORBIDDEN", message: need === "admin" ? "Only project admins can do that." : "You have read-only access to this project." });
  return role;
}

export async function projectOfIssue(db: Pick<DB, "select">, issueId: string) {
  const [i] = await db.select({ projectId: issue.projectId }).from(issue).where(eq(issue.id, issueId));
  if (!i) throw new TRPCError({ code: "NOT_FOUND" });
  return i.projectId;
}

/** Of these users, who may see this project? (So mentions and watch notifications never leak private work.) */
export async function usersWithAccess(db: Pick<DB, "select">, projectId: string, userIds: string[]) {
  if (!userIds.length) return [];
  const [[p], people, members] = await Promise.all([
    db.select({ visibility: project.visibility }).from(project).where(eq(project.id, projectId)),
    db.select({ id: user.id, role: user.role }).from(user).where(inArray(user.id, userIds)),
    db.select({ userId: projectMember.userId, role: projectMember.role }).from(projectMember).where(eq(projectMember.projectId, projectId)),
  ]);
  if (!p) return [];
  const m = new Map(members.map((x) => [x.userId, x.role]));
  return people.filter((u) => effectiveRole(u, p.visibility, m.get(u.id))).map((u) => u.id);
}
