"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(params.get("error") ? "This link has expired or was already used. Ask for a new one." : null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const pw = String(f.get("password"));
        if (pw !== String(f.get("confirm"))) return setError("The two passwords don’t match.");
        setBusy(true);
        const res = await authClient.resetPassword({ newPassword: pw, token: token ?? "" });
        setBusy(false);
        if (res.error) return setError(res.error.message ?? "This link has expired. Ask for a new one.");
        router.replace("/sign-in");
      }}
    >
      <Input name="password" type="password" required minLength={10} autoComplete="new-password" placeholder="New password (10+ characters)" aria-label="New password" />
      <Input name="confirm" type="password" required minLength={10} autoComplete="new-password" placeholder="Type it again" aria-label="Confirm new password" />
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <Button variant="primary" className="h-10 w-full" disabled={busy || !token}>
        Save new password
      </Button>
      <p className="text-[12px] text-muted">You’ll be signed out on your other devices.</p>
    </form>
  );
}

export default function ResetPassword() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-[1.75rem] leading-tight">Choose a new password</h1>
        <Suspense>
          <ResetForm />
        </Suspense>
        <a href="/forgot-password" className="mt-6 block text-[13px] text-accent hover:underline">
          Need a new link?
        </a>
      </div>
    </main>
  );
}
