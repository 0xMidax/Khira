import "server-only";
import { appendFile } from "node:fs/promises";
import { getConfig } from "./integrations/config";

type Mail = { to: string; subject: string; text: string; replyTo?: string };

/**
 * SMTP_URL set (smtp://user:pass@host:587 or smtps://…:465) → send through your own mail server.
 * Resend connected (Integrations page or RESEND_API_KEY) → send via Resend.
 * EMAIL_OUTBOX_FILE set → append JSON lines to that file (local dev / E2E).
 * Neither → log in dev; fail loudly in production so verification can't be silently skipped.
 */
let smtp: import("nodemailer").Transporter | null = null;

export async function sendMail(mail: Mail) {
  if (process.env.SMTP_URL) {
    const nodemailer = await import("nodemailer");
    smtp ??= nodemailer.createTransport(process.env.SMTP_URL);
    await smtp.sendMail({ from: process.env.EMAIL_FROM ?? "Khira <noreply@example.com>", to: mail.to, subject: mail.subject, text: mail.text, replyTo: mail.replyTo });
    return;
  }
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
  throw new Error("No email provider: set SMTP_URL, or connect Resend on the Integrations page.");
}
