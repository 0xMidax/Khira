import "server-only";
import { appendFile } from "node:fs/promises";
import { getConfig } from "./integrations/config";

type Mail = { to: string; subject: string; text: string; replyTo?: string };

/**
 * Resend connected (Integrations page or RESEND_API_KEY) → send via Resend.
 * EMAIL_OUTBOX_FILE set → append JSON lines to that file (local dev / E2E).
 * Neither → log in dev; fail loudly in production so verification can't be silently skipped.
 */
export async function sendMail(mail: Mail) {
  const cfg = await getConfig("email");
  if (cfg?.resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from ?? "Khira <noreply@example.com>", to: mail.to, subject: mail.subject, text: mail.text, reply_to: mail.replyTo }),
    });
    if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
    return;
  }
  if (process.env.EMAIL_OUTBOX_FILE) {
    await appendFile(process.env.EMAIL_OUTBOX_FILE, JSON.stringify(mail) + "\n");
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n[email] to ${mail.to}: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  throw new Error("No email provider: connect email on the Integrations page (or set RESEND_API_KEY).");
}
