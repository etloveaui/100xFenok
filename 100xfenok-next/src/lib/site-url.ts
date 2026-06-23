const DEFAULT_SITE_ORIGIN = "https://100xfenok.etloveaui.workers.dev";

function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_SITE_ORIGIN;
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

export const siteOrigin = normalizeOrigin(
  process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    DEFAULT_SITE_ORIGIN,
);

export function canonicalPath(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (path === "/") return "/";
  return path.endsWith("/") ? path : `${path}/`;
}

export function canonicalUrl(pathname: string): string {
  return new URL(canonicalPath(pathname), siteOrigin).toString();
}
