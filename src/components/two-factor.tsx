"use client";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button, Input } from "./ui";

/** Turn two-step sign-in (authenticator app + backup codes) on or off for yourself. */
export function TwoFactorSection() {
  const session = authClient.useSession();
  const enabled = !!(session.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled;
  const [setup, setSetup] = useState<{ qr: string; secret: string; backupCodes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.enable({ password: String(new FormData(e.currentTarget).get("password")), issuer: "Khira" });
    setBusy(false);
    if (res.error || !res.data || res.data.method !== "totp") return setError(res.error?.message ?? "That password isn’t right.");
    const secret = new URL(res.data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ qr: await QRCode.toDataURL(res.data.totpURI, { margin: 1, width: 200 }), secret, backupCodes: res.data.backupCodes });
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const res = await authClient.twoFactor.verifyTotp({ code: String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "") });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? "That code didn’t work. Check your phone’s clock and try again.");
    toast.success("Two-step sign-in is on");
    setSetup(null);
    session.refetch();
  }

  async function disable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await authClient.twoFactor.disable({ password: String(new FormData(e.currentTarget).get("password")) });
    if (res.error) return setError(res.error.message ?? "That password isn’t right.");
    toast("Two-step sign-in is off");
    session.refetch();
  }

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Two-step sign-in</h2>
      <p className="text-[13px] text-muted">After your password, also ask for a code from an authenticator app (Google Authenticator, 1Password, Authy…).</p>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {enabled && !setup ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={disable}>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent">On</span>
          <Input name="password" type="password" required autoComplete="current-password" placeholder="Password to turn it off" className="w-64" aria-label="Password" />
          <Button variant="danger">Turn off</Button>
        </form>
      ) : setup ? (
        <div className="space-y-3 card p-4">
          <ol className="list-decimal space-y-1 pl-5 text-[13px]">
            <li>Scan this code with your authenticator app.</li>
            <li>Save the backup codes somewhere safe. Each one works once if you lose your phone.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
            <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg border border-line bg-white p-1" />
            <div className="min-w-0 flex-1 space-y-2 text-[13px]">
              <div>
                <div className="text-muted">Can’t scan? Enter this key:</div>
                <code className="break-all font-mono">{setup.secret}</code>
              </div>
              <div>
                <div className="text-muted">Backup codes</div>
                <pre className="mt-1 grid grid-cols-2 gap-x-4 rounded-md bg-sunken p-2 font-mono text-[12px]">{setup.backupCodes.join("\n")}</pre>
                <Button size="sm" className="mt-1" onClick={() => navigator.clipboard.writeText(setup.backupCodes.join("\n")).then(() => toast.success("Copied"))}>
                  Copy codes
                </Button>
              </div>
            </div>
          </div>
          <form className="flex gap-2" onSubmit={confirm}>
            <Input name="code" required autoComplete="one-time-code" inputMode="numeric" placeholder="123456" className="w-36 font-mono tracking-widest" aria-label="Code from your app" />
            <Button variant="primary" disabled={busy}>
              Turn on
            </Button>
          </form>
        </div>
      ) : (
        <form className="flex flex-wrap gap-2" onSubmit={start}>
          <Input name="password" type="password" required autoComplete="current-password" placeholder="Your password" className="w-64" aria-label="Password" />
          <Button disabled={busy}>Set up two-step sign-in</Button>
        </form>
      )}
    </section>
  );
}
