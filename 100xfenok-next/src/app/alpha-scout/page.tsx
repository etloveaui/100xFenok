import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import AppShell from '@/components/shell/AppShell';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import { ROUTES } from '@/lib/routes';
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from '@/lib/server/legacy-bridge';
import { getDesignVersionFromSearchParams } from '@/lib/design/version';
import AlphaScoutV2Client from './AlphaScoutV2Client';

export const metadata: Metadata = {
  title: 'Alpha Scout',
  description: '숨겨진 투자 기회를 발견하여 알파를 찾는 리서치 리포트',
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );

  if (version !== "v1" && !rawPath && !rawReport) {
    return (
      <div className="fnk-shell">
        <AppShell active="alphaScout" title="Alpha Scout" backHref={ROUTES.home}>
          <AlphaScoutV2Client />
        </AppShell>
      </div>
    );
  }

  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ['alpha-scout/'] });
  const safeReport = sanitizeReportFilename(rawReport);
  const reportPath = safeReport ? `alpha-scout/reports/${safeReport}` : null;
  const hasSafePath = safePath ? await legacyPublicFileExists(safePath) : false;
  const hasReportPath = reportPath ? await legacyPublicFileExists(reportPath) : false;
  const iframeSrc =
    safePath && hasSafePath
      ? `/${safePath}`
      : reportPath && hasReportPath
        ? `/${reportPath}`
        : '/alpha-scout/alpha-scout-main.html';

  const frame = (
    <RouteEmbedFrame
      src={iframeSrc}
      title="100x Alpha Scout"
      loading="eager"
      shellClassName={version === "v1" ? undefined : "route-embed-shell-app"}
    />
  );

  if (version === "v1") return frame;

  return (
    <div className="fnk-shell">
      <AppShell active="alphaScout" title="Alpha Scout" backHref={ROUTES.home}>
        <div
          className="space-y-[var(--s4)]"
          data-alpha-scout-report-surface="true"
          data-alpha-scout-route-owner="legacy-report-html"
        >
          <section className="panel" data-alpha-scout-boundary="true">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600"
                data-alpha-scout-boundary-chip="legacy-html"
              >
                레거시 HTML
              </span>
              <span
                className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600"
                data-alpha-scout-boundary-chip="report-deeplink"
              >
                리포트 딥링크
              </span>
              <span
                className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600"
                data-alpha-scout-boundary-chip="v2-owner"
              >
                V2 아카이브
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Link
                href={ROUTES.alphaScout}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
                data-alpha-scout-owner-link="v2-archive"
              >
                V2 아카이브
              </Link>
              <Link
                href={ROUTES.posts}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
                data-alpha-scout-owner-link="posts"
              >
                분석 아카이브
              </Link>
              <Link
                href={ROUTES.dailyWrap}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
                data-alpha-scout-owner-link="daily-wrap"
              >
                Daily Wrap
              </Link>
            </div>
          </section>
          <div data-alpha-scout-legacy-frame="true">{frame}</div>
        </div>
      </AppShell>
    </div>
  );
}
