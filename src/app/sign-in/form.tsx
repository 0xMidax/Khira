"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { Slice } from "@/components/brand";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ providers }: { providers: string[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setBusy(true);
    setError(null);
    const res =
      mode === "in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(f.get("name")), callbackURL: "/" });
    setBusy(false);
    if (mode === "in" && res.error?.status === 403) return setSentTo(email); // unverified: a fresh link was just sent
    if (res.error) return setError(res.error.message ?? "Something went wrong. Try again.");
    if (mode === "up") return setSentTo(email);
    router.replace("/");
    router.refresh();
  }

  if (sentTo)
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-sm">
          <h1 className="mb-2 text-xl font-semibold">Check your email</h1>
          <p className="mb-6 text-muted">
            We sent a verification link to <span className="text-ink">{sentTo}</span>. Open it to finish signing in.
          </p>
          <Button onClick={() => (setSentTo(null), setMode("in"))}>Back to sign in</Button>
        </div>
      </main>
    );

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="seed-texture relative hidden overflow-hidden bg-rail p-12 text-rail-ink lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <Slice size={30} />
          <span className="font-[family-name:var(--font-display)] text-xl font-bold text-white">khira</span>
        </div>
        <div className="relative z-10 mt-auto max-w-md">
          <p className="font-[family-name:var(--font-display)] text-[2.75rem] leading-[1.05] font-semibold tracking-tight text-white">
            Track the work.
            <br />
            <span className="text-lime">Skip the ceremony.</span>
          </p>
          <p className="mt-4 max-w-sm text-rail-muted">Boards, sprints and releases for small teams, with the busywork (standups, triage, release notes) done for you.</p>
        </div>
        <Slice size={520} className="pointer-events-none absolute -top-24 -right-40 opacity-90 drop-shadow-[0_30px_60px_rgb(0_0_0/0.45)] motion-safe:animate-[spin_120s_linear_infinite]" />
      </section>
      <div className="grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <Slice size={28} />
          <span className="font-[family-name:var(--font-display)] text-lg font-bold">khira</span>
        </div>
        <h1 className="mb-1 text-[1.75rem] leading-tight">{mode === "in" ? "Welcome back" : "Join your team"}</h1>
        <p className="mb-6 text-muted">
          {mode === "in" ? "Pick up where your team left off." : "Use the email your admin added to the workspace."}
        </p>

        <form onSubmit={submit} className="space-y-3">
          {mode === "up" && (
            <label className="block">
              <span className="mb-1 block text-[13px] text-muted">Name</span>
              <Input name="name" required autoComplete="name" />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Email</span>
            <Input name="email" type="email" required autoComplete="email" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Password</span>
            <Input name="password" type="password" required minLength={10} autoComplete={mode === "in" ? "current-password" : "new-password"} />
          </label>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <Button variant="primary" className="h-10 w-full" disabled={busy}>
            {mode === "in" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {providers.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {providers.map((p) => (
              <Button key={p} onClick={() => authClient.signIn.social({ provider: p, callbackURL: "/" })}>
                Continue with {p === "github" ? "GitHub" : "Google"}
              </Button>
            ))}
          </div>
        )}

        <p className="mt-6 text-[13px] text-muted">
          {mode === "in" ? "New to the team? " : "Already have an account? "}
          <button className="text-accent underline-offset-2 hover:underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
      </div>
    </main>
  );
}
