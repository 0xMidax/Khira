# Khira production image.
#   docker compose up -d          (see docs/self-hosting.md)
# Stages: deps → build → migrate (runs DB migrations once) → app (the server).

FROM node:22-alpine AS base
RUN npm i -g pnpm@10.34.6
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# The build never touches a real database; the embedded one keeps page-data collection happy.
ENV NEXT_OUTPUT=standalone DATABASE_URL=pglite://
RUN pnpm exec next build

# Applies pending migrations and exits. Compose runs it before the app starts.
FROM deps AS migrate
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
CMD ["pnpm", "exec", "drizzle-kit", "migrate"]

FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 LOCAL_UPLOAD_DIR=/data/uploads
RUN addgroup -S khira && adduser -S khira -G khira && mkdir -p /data/uploads && chown khira:khira /data/uploads
COPY --from=build --chown=khira:khira /app/.next/standalone ./
COPY --from=build --chown=khira:khira /app/.next/static ./.next/static
COPY --from=build --chown=khira:khira /app/public ./public
USER khira
EXPOSE 3000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
