import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market Radar',
  description: '거시경제 지표 통합 대시보드',
};

type PageProps = {
  searchParams?: Promise<{ path?: string | string[] }>;
};

function sanitizeRadarPath(rawPath?: string): string | null {
  if (!rawPath) return null;

  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const normalized = decoded.replace(/^\/+/, '');
  if (!normalized.startsWith('tools/macro-monitor/')) return null;
  if (!/^[A-Za-z0-9/_\-.?=&]+$/.test(normalized)) return null;
  if (!normalized.includes('.html')) return null;
  return normalized;
}

export default async function RadarPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = Array.isArray(params.path) ? params.path[0] : params.path;
  const safePath = sanitizeRadarPath(rawPath);
  const iframeSrc = safePath ? `/${safePath}` : '/tools/macro-monitor/index.html';

  return (
    <div className="route-embed-shell">
      <iframe
        src={iframeSrc}
        title="100x Market Radar"
        loading="eager"
        className="h-full w-full border-0"
      />
    </div>
  );
}
