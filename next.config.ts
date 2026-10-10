import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    async headers() {
      return [{ source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
      ] }];
    },
    distDir:
      phase === PHASE_DEVELOPMENT_SERVER
        ? process.env.NEXT_DIST_DIR ?? ".next-dev-3000"
        : ".next",
  };
}
