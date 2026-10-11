import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { count } from "drizzle-orm";
import { headers } from "next/headers";
import { isSignupAllowed } from "@/lib/signup";
import { db, schema } from "./db";
import { sendMail } from "./email";

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

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Verification proves inbox ownership; without it the ALLOWED_SIGNUPS domain check is spoofable.
  emailAndPassword: { enabled: true, minPasswordLength: 10, requireEmailVerification: true },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: ({ user, url }) =>
      sendMail({ to: user.email, subject: "Verify your email for Khira", text: `Open this link to verify your email and sign in:\n\n${url}` }),
  },
  socialProviders: social,
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "member" },
    },
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          const [{ n }] = await db.select({ n: count() }).from(schema.user);
          if (!isSignupAllowed(u.email, process.env.ALLOWED_SIGNUPS, n === 0)) {
            // Not 403: better-auth masks 403s as a fake "check your email" success. This message leaks no account info.
            throw new APIError("BAD_REQUEST", { message: "Sign-ups are invite-only for this workspace. Ask an admin to add your email." });
          }
          return { data: { ...u, role: n === 0 ? "admin" : "member" } };
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type SessionUser = typeof auth.$Infer.Session.user;

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export const socialProviders = Object.keys(social);
