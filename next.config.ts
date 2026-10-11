import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E builds into its own dir so it never clobbers a running `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PGlite resolves its WASM/data files from its own package path; bundling breaks that.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
