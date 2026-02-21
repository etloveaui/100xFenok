import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Alpha Scout',
  description: '숨겨진 투자 기회를 발견하여 알파를 찾는 리서치 리포트',
};

type PageProps = {
  searchParams?: Promise<{ path?: string | string[]; report?: string | string[] }>;
};

function sanitizeAlphaPath(rawPath?: string): string | null {
  if (!rawPath) return null;

  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const normalized = decoded.replace(/^\/+/, '');
  if (!normalized.startsWith('alpha-scout/')) return null;
  if (!/^[A-Za-z0-9/_\-.?=&]+$/.test(normalized)) return null;
  if (!normalized.includes('.html')) return null;
  return normalized;
}

function sanitizeReportFilename(rawReport?: string): string | null {
  if (!rawReport) return null;

  let decoded = rawReport;
  try {
    decoded = decodeURIComponent(rawReport);
  } catch {
    return null;
  }

  if (!/^[A-Za-z0-9._-]+\.html$/.test(decoded)) return null;
  return decoded;
}

export default async function AlphaScoutPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = Array.isArray(params.path) ? params.path[0] : params.path;
  const rawReport = Array.isArray(params.report) ? params.report[0] : params.report;

  const safePath = sanitizeAlphaPath(rawPath);
  const safeReport = sanitizeReportFilename(rawReport);
  const iframeSrc = safePath
    ? `/${safePath}`
    : safeReport
      ? `/alpha-scout/reports/${safeReport}`
      : '/alpha-scout/alpha-scout-main.html';

  return (
    <div className="route-embed-shell">
      <iframe
        src={iframeSrc}
        title="100x Alpha Scout"
        loading="eager"
        className="h-full w-full border-0"
      />
    </div>
  );
}
