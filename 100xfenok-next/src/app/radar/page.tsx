import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
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

const RADAR_BOUNDARY_CHIPS = [
  { key: 'legacy-monitor', label: '레거시 모니터' },
  { key: 'native-macro', label: '네이티브 매크로' },
  { key: 'detail-bridge', label: '상세 브리지' },
] as const;

const RADAR_OWNER_LINKS = [
  { key: 'macro-chart', label: 'Macro Chart', href: ROUTES.macroChart },
  { key: 'workbench', label: 'Workbench', href: ROUTES.workbench },
  { key: 'explore', label: 'Explore', href: ROUTES.explore },
] as const;

const RADAR_CATEGORY_LINKS = [
  { key: 'all', label: '전체', href: ROUTES.radar },
  { key: 'liquidity', label: '유동성', href: `${ROUTES.radar}?category=liquidity` },
  { key: 'rates', label: '금리', href: `${ROUTES.radar}?category=rates` },
  { key: 'sentiment', label: '심리', href: `${ROUTES.radar}?category=sentiment` },
] as const;

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
        <div
          data-radar-surface
          data-radar-route-owner="legacy-macro-monitor"
          className="min-h-screen px-3 py-4 sm:px-4 md:px-6"
          style={{ backgroundColor: "var(--c-surface-2)" }}
        >
          <section
            data-radar-boundary
            className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Route owner</p>
                <h1 className="mt-2 text-xl font-black text-slate-900">Market Radar (레거시)</h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  기존 macro-monitor HTML을 보존하는 브리지 화면입니다. 네이티브 차트·워크벤치 이동과
                  레거시 상세 경로를 분리해 route ownership을 명확히 둡니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {RADAR_BOUNDARY_CHIPS.map((chip) => (
                  <span
                    key={chip.key}
                    data-radar-boundary-chip={chip.key}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700"
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {RADAR_OWNER_LINKS.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  data-radar-owner-link={link.key}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {RADAR_CATEGORY_LINKS.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  data-radar-category-link={link.key}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </section>
          <div data-radar-legacy-frame>
            {frame}
          </div>
        </div>
      </AppShell>
    </div>
  );
}
