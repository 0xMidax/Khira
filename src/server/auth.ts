import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { count, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { isSignupAllowed } from "@/lib/signup";
import { db, schema } from "./db";
import { sendMail } from "./email";
import { acceptInvite, findValidInvite } from "./services/invites";

const social = {
  ...(process.env.GOOGLE_CLIENT_ID && {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  }),
  ...(process.env.GITHUB_CLIENT_ID && {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  }),
};

// The team's single sign-on (platform repo, identity/). Access is decided there: only people in
// the khira-member / khira-admin groups get a token for Khira at all.
const authentik = process.env.AUTHENTIK_URL
  ? genericOAuth({
      config: [
        {
          providerId: "authentik",
          clientId: process.env.AUTHENTIK_CLIENT_ID ?? "khira",
          clientSecret: process.env.AUTHENTIK_CLIENT_SECRET!,
          discoveryUrl: `${process.env.AUTHENTIK_URL}/application/o/khira/.well-known/openid-configuration`,
          scopes: ["openid", "email", "profile"],
          pkce: true,
          mapProfileToUser: (p) => ({ role: (p.groups as string[] | undefined)?.includes("khira-admin") ? "admin" : "member" }),
        },
      ],
    })
  : null;

const viaAuthentik = (ctx: { params?: Record<string, string | undefined> } | null) => ctx?.params?.id === "authentik";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Extra addresses Khira may be opened at (comma-separated). In development, 127.0.0.1 works as well as localhost.
  trustedOrigins: [
    ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? []),
    ...(process.env.NODE_ENV !== "production" ? ["http://localhost:3000", "http://127.0.0.1:3000"] : []),
  ],
  // Verification proves inbox ownership; without it the ALLOWED_SIGNUPS domain check is spoofable.
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: ({ user, url }) =>
      sendMail({
        to: user.email,
        subject: "Reset your Khira password",
        text: `Someone (hopefully you) asked to reset your Khira password. Open this link within an hour to choose a new one:\n\n${url}\n\nIf it wasn't you, ignore this email; your password stays the same.`,
      }),
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: ({ user, url }) =>
      sendMail({ to: user.email, subject: "Verify your email for Khira", text: `Open this link to verify your email and sign in:\n\n${url}` }),
  },
  socialProviders: social,
  // Never join a sign-in to an existing user just because the emails match: Authentik reports every
  // email as verified, so a matching email would be enough to take over that user. Existing users are
  // linked once by an admin (platform repo, docs/identity.md); anything else starts a new user.
  account: { accountLinking: { disableImplicitLinking: true } },
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "member" },
      deactivatedAt: { type: "date", input: false, required: false },
    },
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  databaseHooks: {
    user: {
      create: {
        before: async (u, ctx) => {
          // Authentik already checked group membership; its group decides the role.
          if (viaAuthentik(ctx)) return { data: { ...u, role: u.role === "admin" ? "admin" : "member" } };
          const [{ n }] = await db.select({ n: count() }).from(schema.user);
          // An in-app invite (with its role) or the ALLOWED_SIGNUPS allowlist; the very first user bootstraps the admin.
          const invite = await findValidInvite(db, u.email);
          if (!invite && !isSignupAllowed(u.email, process.env.ALLOWED_SIGNUPS, n === 0)) {
            // Not 403: better-auth masks 403s as a fake "check your email" success. This message leaks no account info.
            throw new APIError("BAD_REQUEST", { message: "Sign-ups are invite-only for this workspace. Ask an admin to invite your email." });
          }
          return { data: { ...u, role: n === 0 ? "admin" : (invite?.role ?? "member") } };
        },
        after: async (u) => {
          await acceptInvite(db, u.email);
        },
      },
    },
    session: {
      create: {
        // Deactivated people can't start new sessions (existing ones are deleted when they're deactivated).
        before: async (session) => {
          const [u] = await db.select({ deactivatedAt: schema.user.deactivatedAt }).from(schema.user).where(eq(schema.user.id, session.userId));
          if (u?.deactivatedAt) throw new APIError("FORBIDDEN", { message: "This account has been deactivated. Ask a workspace admin." });
        },
      },
    },
  },
  plugins: [twoFactor({ issuer: "Khira" }), ...(authentik ? [authentik] : []), nextCookies()],
});

export type SessionUser = typeof auth.$Infer.Session.user;

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** The signed-in person, only if their email is verified and they haven't been deactivated. */
export async function getMember() {
  const u = (await getSession())?.user;
  return u?.emailVerified && !u.deactivatedAt ? u : null;
}

export const socialProviders = Object.keys(social);
export const ssoEnabled = authentik !== null;
