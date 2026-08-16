import path from "node:path";
import type { NextConfig } from "next";

const buildTarget = process.env.NEXT_BUILD_TARGET ?? "runtime";
const isStaticProfile = buildTarget === "static";
const isCloudflareProfile = buildTarget === "cloudflare";
const repositoryRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  // Runtime-first build. "static" profile keeps dist output only.
  ...(isStaticProfile ? { distDir: "dist" } : {}),

  // Disable Next image optimization for static export and Cloudflare preview.
  images: {
    unoptimized: isStaticProfile || isCloudflareProfile,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },

  // Turbopack must resolve the shared cloud-data-plane modules one directory
  // above the app. Keep output-file tracing at the app default: widening that
  // separate root changes Next's standalone layout in a way OpenNext cannot
  // consume, while these statically imported modules are bundled by Turbopack.
  turbopack: {
    root: repositoryRoot,
  },

  allowedDevOrigins: ["127.0.0.1"],

  // Trailing slash for consistent URLs
  trailingSlash: true,
  ...(isCloudflareProfile ? { skipTrailingSlashRedirect: true } : {}),

  // CDN cache for static data JSON (daily-updated, 5 min browser + 10 min stale)
  async headers() {
    const headers = [
      {
        source: "/data/:path*.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300, stale-while-revalidate=600",
          },
        ],
      },
    ];

    return headers;
  },

  // Keep legacy .html detail links inside Next.js shell routes.
  async redirects() {
    return [
      {
        source: "/briefing",
        destination: "/",
        permanent: false,
      },
      {
        source: "/filings/nvda-10k",
        destination: "/stock/NVDA?tab=filings",
        permanent: false,
      },
      {
        source: "/vr/vr-complete-system.html",
        destination: "/vr/?path=vr/vr-complete-system.html",
        permanent: false,
        missing: [
          {
            type: "query",
            key: "embed",
            value: "1",
          },
        ],
      },
      {
        source: "/vr/vr-total-guide-calculator.html",
        destination: "/vr/?path=vr/vr-total-guide-calculator.html",
        permanent: false,
        missing: [
          {
            type: "query",
            key: "embed",
            value: "1",
          },
        ],
      },
    ];
  },

};

export default nextConfig;
