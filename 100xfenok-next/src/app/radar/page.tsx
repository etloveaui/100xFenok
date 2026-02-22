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

type PageProps = {
  searchParams?: Promise<{ path?: string | string[] }>;
};

export default async function RadarPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = getSingleSearchParam(params.path);
  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ['tools/macro-monitor/'] });
  const iframeSrc = safePath && legacyPublicFileExists(safePath)
    ? `/${safePath}`
    : '/tools/macro-monitor/index.html';

  return <RouteEmbedFrame src={iframeSrc} title="100x Market Radar" loading="eager" />;
}
