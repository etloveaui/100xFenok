import type { NextConfig } from "next";

const buildTarget = process.env.NEXT_BUILD_TARGET ?? "runtime";
const isStaticProfile = buildTarget === "static";
const isCloudflareProfile = buildTarget === "cloudflare";

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
      // Measured 2026-08-23: a redirect declared HERE is served as a real HTTP
      // redirect, and the same redirect written only as redirect() inside a page
      // component is not - the adapter renders that page and emits 200 with a
      // meta refresh in the body. /briefing and /filings/nvda-10k above proved
      // the working half; /market and /live-bench were the failing half, and
      // neither the redirect/permanentRedirect choice nor an exported metadata
      // object made any difference. A 200 is indexable and a redirect is not, so
      // the difference is not cosmetic. Their page components stay in place and
      // are simply never reached, exactly like the two above.
      {
        source: "/market",
        destination: "/market-valuation",
        permanent: true,
      },
      {
        source: "/live-bench",
        destination: "/admin/live",
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
