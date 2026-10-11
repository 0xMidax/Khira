/** Report unexpected server errors (Sentry when configured, always the log). */
export async function reportError(error: unknown, context: Record<string, unknown> = {}) {
  console.error("[error]", context, error);
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureException(error, { extra: context });
}
