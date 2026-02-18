import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for Cloudflare Pages
  output: 'export',
  distDir: 'dist',
  
  // Disable image optimization for static export
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
      },
    ],
  },
  
  // Turbopack root configuration
  turbopack: {
    root: process.cwd(),
  },
  
  // Trailing slash for consistent URLs
  trailingSlash: true,
};

export default nextConfig;
