import type { Metadata } from 'next';
import { cookies } from 'next/headers';
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
        <AppShell active="explore" title="Alpha Scout" backHref={ROUTES.explore}>
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
      <AppShell active="explore" title="Alpha Scout" backHref={ROUTES.explore}>
        {frame}
      </AppShell>
    </div>
  );
}
