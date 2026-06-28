import type { Metadata } from "next";
import { cookies } from "next/headers";
import AppShell from "@/components/shell/AppShell";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
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
    <div className="fnk-shell">
      <AppShell active="dailyWrap" title="100x Daily Wrap" backHref={ROUTES.home}>
        {frame}
      </AppShell>
    </div>
  );
}
