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
import RadarNativeClient, { type RadarCategory } from './RadarNativeClient';

export const metadata: Metadata = {
  title: 'Market Radar',
  description: '유동성과 시장 심리 지표를 한 화면에서 확인하는 대시보드',
};

const VALID_RADAR_CATEGORIES: ReadonlySet<string> = new Set(['all', 'liquidity', 'sentiment']);

const RADAR_BOUNDARY_CHIPS = [
  { key: 'liquidity-trio', label: '유동성 3종' },
  { key: 'sentiment-single', label: '심리 1종' },
  { key: 'detail-pages', label: '상세 연결' },
] as const;

const RADAR_OWNER_LINKS = [
  { key: 'macro-chart', label: '매크로 차트 Macro Chart ›', href: ROUTES.macroChart },
  { key: 'market-events', label: '시장 이벤트 Market Events ›', href: ROUTES.marketEvents },
  { key: 'market-valuation', label: '시장 밸류에이션 Market Valuation ›', href: ROUTES.market },
] as const;

const RADAR_CATEGORY_LINKS = [
  { key: 'all', label: '전체', href: ROUTES.radar },
  { key: 'liquidity', label: '유동성', href: `${ROUTES.radar}?category=liquidity` },
  { key: 'sentiment', label: '심리', href: `${ROUTES.radar}?category=sentiment` },
] as const;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function resolveCategory(rawCategory: string | null): RadarCategory {
  if (rawCategory === 'liquidity' || rawCategory === 'sentiment') return rawCategory;
  return 'all';
}

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
  const hasSafePath = safePath ? await legacyPublicFileExists(safePath) : false;
  const category = resolveCategory(typeof rawCategory === 'string' ? rawCategory : null);

  // 상세 자료는 기존 macro-monitor 상세 페이지를 그대로 연결한다.
  if (safePath && hasSafePath) {
    const frame = (
      <RouteEmbedFrame
        src={`/${safePath}`}
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
            data-radar-route-owner="native-radar"
            className="min-h-screen px-3 py-4 sm:px-4 md:px-6"
            style={{ backgroundColor: "var(--c-surface-2)" }}
          >
            <div data-radar-legacy-frame>
              {frame}
            </div>
          </div>
        </AppShell>
      </div>
    );
  }

  const native = <RadarNativeClient initialCategory={category} />;

  if (version === "v1") return native;

  return (
    <div className="fnk-shell">
      <AppShell active="explore" title="Market Radar" backHref={ROUTES.home}>
        <div
          data-radar-surface
          data-radar-route-owner="native-radar"
          className="min-h-screen px-3 py-4 sm:px-4 md:px-6"
          style={{ backgroundColor: "var(--c-surface-2)" }}
        >
          <section
            data-radar-boundary
            className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <h1 className="text-lg font-black text-slate-900">Market Radar</h1>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  카드를 누르면 상세 자료로 이동합니다.
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

            <div className="mt-2 grid gap-2 sm:grid-cols-3">
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

            <div className="mt-2 flex flex-wrap gap-2">
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
          {native}
        </div>
      </AppShell>
    </div>
  );
}
