import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import AppShell from '@/components/shell/AppShell';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import { getDesignVersionFromSearchParams } from '@/lib/design/version';
import { ROUTES } from '@/lib/routes';
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
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RadarPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );
  const rawPath = getSingleSearchParam(params.path);
  const rawCategory = getSingleSearchParam(params.category);
  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ['tools/macro-monitor/'] });
  const isValidCategory = typeof rawCategory === 'string' && VALID_RADAR_CATEGORIES.has(rawCategory);
  const hasSafePath = safePath ? await legacyPublicFileExists(safePath) : false;
  const baseIframeSrc = safePath && hasSafePath
    ? `/${safePath}`
    : '/tools/macro-monitor/index.html';
  const shouldApplyCategory = isValidCategory
    && rawCategory !== 'all'
    && (safePath === null || safePath === 'tools/macro-monitor/index.html');
  const iframeSrc = shouldApplyCategory
    ? `${baseIframeSrc}?category=${encodeURIComponent(rawCategory)}`
    : baseIframeSrc;

  const frame = (
    <RouteEmbedFrame
      src={iframeSrc}
      title="100x Market Radar"
      loading="eager"
      shellClassName={version === "v1" ? undefined : "route-embed-shell-app"}
    />
  );

  if (version === "v1") return frame;

  return (
    <div className="fnk-shell">
      <AppShell active="explore" title="Market Radar" backHref={ROUTES.home}>
        {frame}
      </AppShell>
    </div>
  );
}
