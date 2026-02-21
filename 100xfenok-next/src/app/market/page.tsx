import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market Wrap',
  description: 'AI 기반 멀티에셋 분석으로 시장 핵심 동인을 심층 제공',
};

type PageProps = {
  searchParams?: Promise<{ path?: string | string[] }>;
};

function sanitizeMarketPath(rawPath?: string): string | null {
  if (!rawPath) return null;

  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const normalized = decoded.replace(/^\/+/, '');
  if (!normalized.startsWith('100x/')) return null;
  if (!/^[A-Za-z0-9/_\-.?=&]+$/.test(normalized)) return null;
  if (!normalized.includes('.html')) return null;
  return normalized;
}

export default async function MarketPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = Array.isArray(params.path) ? params.path[0] : params.path;
  const safePath = sanitizeMarketPath(rawPath);
  const iframeSrc = safePath ? `/${safePath}` : '/100x/100x-main.html';

  return (
    <div className="route-embed-shell">
      <iframe
        src={iframeSrc}
        title="100x Market Wrap"
        loading="eager"
        className="h-full w-full border-0"
      />
    </div>
  );
}
