const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  import("@sentry/nextjs").then((Sentry) => Sentry.init({ dsn, tracesSampleRate: 0.05, environment: process.env.NODE_ENV }));
}
