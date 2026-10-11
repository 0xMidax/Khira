"use client";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-[1.75rem] leading-tight">Reset your password</h1>
        {sent ? (
          <p className="text-muted">If that email has an account, a reset link is on its way. It works for one hour.</p>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              // Same answer whether or not the account exists, so this can't be used to discover emails.
              await authClient.requestPasswordReset({ email: String(new FormData(e.currentTarget).get("email")), redirectTo: "/reset-password" });
              setBusy(false);
              setSent(true);
            }}
          >
            <p className="text-muted">Enter your email and we’ll send you a link to choose a new password.</p>
            <Input name="email" type="email" required autoComplete="email" aria-label="Email" />
            <Button variant="primary" className="h-10 w-full" disabled={busy}>
              Send reset link
            </Button>
          </form>
        )}
        <a href="/sign-in" className="mt-6 block text-[13px] text-accent hover:underline">
          Back to sign in
        </a>
      </div>
    </main>
  );
}
