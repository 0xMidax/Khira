import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { auth } from "./auth";
import { db } from "./db";
import { hit } from "./ratelimit";

export async function createContext(opts: { headers: Headers }) {
  const session = await auth.api.getSession({ headers: opts.headers });
  // Defense in depth: never treat an unverified address as a team member.
  return { db, user: session?.user.emailVerified ? session.user : null };
}
export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: { ...shape.data, zodError: error.cause instanceof ZodError ? error.cause.flatten() : null },
  }),
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/** Any signed-in user (guests included) — read access. Writes are rate limited per user; AI calls more tightly. */
export const authedProcedure = t.procedure.use(async ({ ctx, next, type, path }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (type === "mutation") {
    const ai = path.startsWith("ai.");
    if (!(await hit(`${ai ? "ai" : "w"}:${ctx.user.id}`, ai ? 30 : 240, 60)))
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Slow down a little and try again in a minute." });
  }
  return next({ ctx: { ...ctx, user: { ...ctx.user, role: ctx.user.role as Role } } });
});

/** Members and admins — anything that writes. */
export const memberProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role === "guest") throw new TRPCError({ code: "FORBIDDEN", message: "Guests are read-only." });
  return next();
});

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admins only." });
  return next();
});

export type Role = "admin" | "member" | "guest";
