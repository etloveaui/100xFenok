import type { Metadata } from "next";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
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
  const version = getDesignVersionFromSearchParams(params);

  if (version === "v2" || version === "v3" || version === "v4") {
    return <MarketWrapV2 />;
  }

  const requestedDate = getSingleSearchParam(params.date);
  const dateSuffix = isValidDateParam(requestedDate)
    ? `?date=${encodeURIComponent(requestedDate)}`
    : "";

  return (
    <RouteEmbedFrame
      src={`/100x/daily-wrap/daily-wrap-viewer.html${dateSuffix}`}
      title="100x Daily Wrap"
      loading="eager"
    />
  );
}
