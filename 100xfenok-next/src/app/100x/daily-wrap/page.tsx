import type { Metadata } from "next";
import { cookies } from "next/headers";
import AppShell from "@/components/shell/AppShell";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import { getSingleSearchParam } from "@/lib/server/legacy-bridge";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";
import MarketWrapV2 from "@/components/wrap/v2/MarketWrapV2";

export const metadata: Metadata = {
  title: "100x Daily Wrap",
  description: "데일리 마켓 브리핑과 아카이브",
};

type DailyWrapPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const DAILY_WRAP_BOUNDARY_CHIPS = [
  { key: "legacy-viewer", label: "레거시 뷰어" },
  { key: "native-preview", label: "네이티브 미리보기" },
  { key: "date-filter", label: "날짜 필터" },
] as const;

const DAILY_WRAP_OWNER_LINKS = [
  { key: "latest", label: "최신 랩", href: ROUTES.dailyWrap },
  { key: "native", label: "네이티브 미리보기", href: `${ROUTES.dailyWrap}?v2=1` },
  { key: "events", label: "이벤트 캘린더", href: ROUTES.marketEvents },
] as const;

function isValidDateParam(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function DailyWrapPage({ searchParams }: DailyWrapPageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );

  if (version === "v2" || version === "v3" || version === "v4") {
    const native = <MarketWrapV2 />;
    return (
      <div className="fnk-shell">
        <AppShell active="dailyWrap" title="100x Daily Wrap" backHref={ROUTES.home}>
          {native}
        </AppShell>
      </div>
    );
  }

  const requestedDate = getSingleSearchParam(params.date);
  const dateSuffix = isValidDateParam(requestedDate)
    ? `?date=${encodeURIComponent(requestedDate)}`
    : "";

  const frame = (
    <RouteEmbedFrame
      src={`/100x/daily-wrap/daily-wrap-viewer.html${dateSuffix}`}
      title="100x Daily Wrap"
      loading="eager"
      shellClassName={version === "v1" ? undefined : "route-embed-shell-app"}
    />
  );

  if (version === "v1") return frame;

  return (
    <div className="fnk-shell" data-daily-wrap-surface="true">
      <AppShell active="dailyWrap" title="100x Daily Wrap" backHref={ROUTES.home}>
        <div className="space-y-[var(--s4)]" data-daily-wrap-route-owner="legacy-viewer">
          <section className="panel" data-daily-wrap-boundary="true">
            <div className="data-shell-header">
              <div className="data-shell-head-main">
                <p className="data-shell-kicker">Daily Wrap</p>
                <h1 className="data-shell-title">100x Daily Wrap (레거시)</h1>
                <p className="data-shell-desc">
                  기본 경로는 레거시 Daily Wrap 뷰어입니다. 네이티브 랩은 별도 미리보기로 분리하고, 날짜별
                  아카이브는 기존 viewer의 date 파라미터로 유지합니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.08em]">
                  {DAILY_WRAP_BOUNDARY_CHIPS.map((chip) => (
                    <span
                      key={chip.key}
                      className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-slate-600"
                      data-daily-wrap-boundary-chip={chip.key}
                    >
                      {chip.label}
                    </span>
                  ))}
                </div>
              </div>
              <nav className="data-shell-head-actions" aria-label="Daily Wrap 경로">
                {DAILY_WRAP_OWNER_LINKS.map((link) => (
                  <TransitionLink
                    key={link.key}
                    href={link.href}
                    className="data-shell-link min-h-11"
                    style={{ minHeight: 44 }}
                    data-daily-wrap-owner-link={link.key}
                  >
                    {link.label}
                  </TransitionLink>
                ))}
              </nav>
            </div>
          </section>

          <div data-daily-wrap-legacy-frame="true">{frame}</div>
        </div>
      </AppShell>
    </div>
  );
}
