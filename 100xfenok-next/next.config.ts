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

  // Keep legacy .html detail links inside Next.js shell routes.
  async redirects() {
    return [
      {
        source: "/vr/vr-complete-system.html",
        destination: "/vr/?path=vr/vr-complete-system.html",
        permanent: false,
      },
      {
        source: "/vr/vr-total-guide-calculator.html",
        destination: "/vr/?path=vr/vr-total-guide-calculator.html",
        permanent: false,
      },
      {
        source: "/posts/2025-06-23_stablecoin-revolution-complete-masterplan.html",
        destination: "/posts/?path=posts/2025-06-23_stablecoin-revolution-complete-masterplan.html",
        permanent: false,
      },
      {
        source: "/posts/2025-06-22_playbook.html",
        destination: "/posts/?path=posts/2025-06-22_playbook.html",
        permanent: false,
      },
      {
        source: "/posts/2025-06-30_Alpha_Pick_RMD/2025-06-30_Alpha_Pick_RMD-main.html",
        destination: "/posts/?path=posts/2025-06-30_Alpha_Pick_RMD/2025-06-30_Alpha_Pick_RMD-main.html",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
