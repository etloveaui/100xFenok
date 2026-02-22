import type { Metadata } from 'next';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from '@/lib/server/legacy-bridge';

export const metadata: Metadata = {
  title: 'Market Radar',
  description: '거시경제 지표 통합 대시보드',
};

const VALID_RADAR_CATEGORIES = new Set(['all', 'liquidity', 'rates', 'sentiment']);

type PageProps = {
  searchParams?: Promise<{
    path?: string | string[];
    category?: string | string[];
  }>;
};

export default async function RadarPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = getSingleSearchParam(params.path);
  const rawCategory = getSingleSearchParam(params.category);
  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ['tools/macro-monitor/'] });
  const isValidCategory = typeof rawCategory === 'string' && VALID_RADAR_CATEGORIES.has(rawCategory);
  const baseIframeSrc = safePath && legacyPublicFileExists(safePath)
    ? `/${safePath}`
    : '/tools/macro-monitor/index.html';
  const shouldApplyCategory = isValidCategory
    && rawCategory !== 'all'
    && (safePath === null || safePath === 'tools/macro-monitor/index.html');
  const iframeSrc = shouldApplyCategory
    ? `${baseIframeSrc}?category=${encodeURIComponent(rawCategory)}`
    : baseIframeSrc;

  return <RouteEmbedFrame src={iframeSrc} title="100x Market Radar" loading="eager" />;
}
