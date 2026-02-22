import type { Metadata } from 'next';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from '@/lib/server/legacy-bridge';

export const metadata: Metadata = {
  title: 'Market Wrap',
  description: 'AI 기반 멀티에셋 분석으로 시장 핵심 동인을 심층 제공',
};

type PageProps = {
  searchParams?: Promise<{ path?: string | string[] }>;
};

export default async function MarketPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = getSingleSearchParam(params.path);
  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ['100x/'] });
  const iframeSrc = safePath ? `/${safePath}` : '/100x/100x-main.html';
  const effectiveIframeSrc =
    safePath && legacyPublicFileExists(safePath) ? iframeSrc : '/100x/100x-main.html';

  return <RouteEmbedFrame src={effectiveIframeSrc} title="100x Market Wrap" loading="eager" />;
}
