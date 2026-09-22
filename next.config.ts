import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    distDir:
      phase === PHASE_DEVELOPMENT_SERVER
        ? process.env.NEXT_DIST_DIR ?? ".next-dev-3000"
        : ".next",
  };
}
