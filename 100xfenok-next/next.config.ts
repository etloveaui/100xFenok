import type { NextConfig } from "next";

const buildTarget = process.env.NEXT_BUILD_TARGET ?? "runtime";
const isStaticProfile = buildTarget === "static";

const nextConfig: NextConfig = {
  // Runtime-first build. "static" profile keeps dist output only.
  ...(isStaticProfile ? { distDir: "dist" } : {}),

  // Disable image optimization only in static profile
  images: {
    unoptimized: isStaticProfile,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },

  // Turbopack root configuration
  turbopack: {
    root: process.cwd(),
  },

  // Trailing slash for consistent URLs
  trailingSlash: true,

  // CDN cache for static data JSON (daily-updated, 5 min browser + 10 min stale)
  async headers() {
    return [
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
  },

  // Keep legacy .html detail links inside Next.js shell routes.
  async redirects() {
    return [
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
      {
        source: "/travel/:path*",
        destination: "/admin/personal/travel?path=admin/personal/travel/:path*",
        permanent: true,
      },
    ];
  },

};

export default nextConfig;
