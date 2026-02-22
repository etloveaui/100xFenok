import type { Metadata } from 'next';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from '@/lib/server/legacy-bridge';

export const metadata: Metadata = {
  title: 'Alpha Scout',
  description: '숨겨진 투자 기회를 발견하여 알파를 찾는 리서치 리포트',
};

type PageProps = {
  searchParams?: Promise<{ path?: string | string[]; report?: string | string[] }>;
};

function sanitizeReportFilename(rawReport?: string): string | null {
  if (!rawReport) return null;

  let decoded = rawReport;
  try {
    decoded = decodeURIComponent(rawReport);
  } catch {
    return null;
  }

  const normalized = decoded.trim();
  if (!/^[A-Za-z0-9._-]+\.html$/.test(normalized)) return null;
  if (normalized.startsWith(".") || normalized.includes("..")) return null;
  return normalized;
}

export default async function AlphaScoutPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = getSingleSearchParam(params.path);
  const rawReport = getSingleSearchParam(params.report);

  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ['alpha-scout/'] });
  const safeReport = sanitizeReportFilename(rawReport);
  const reportPath = safeReport ? `alpha-scout/reports/${safeReport}` : null;
  const iframeSrc =
    safePath && legacyPublicFileExists(safePath)
      ? `/${safePath}`
      : reportPath && legacyPublicFileExists(reportPath)
        ? `/${reportPath}`
        : '/alpha-scout/alpha-scout-main.html';

  return <RouteEmbedFrame src={iframeSrc} title="100x Alpha Scout" loading="eager" />;
}
