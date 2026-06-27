import type { Metadata } from "next";
import { cookies } from "next/headers";
import AppShell from "@/components/shell/AppShell";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { ROUTES } from "@/lib/routes";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";

export const metadata: Metadata = {
  title: "Stock Analyzer",
  description: "종목 탐색과 비교를 위한 분석 대시보드",
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StockAnalyzerPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );
  const frame = (
    <RouteEmbedFrame
      src="/tools/stock_analyzer/stock_analyzer.html"
      title="Stock Analyzer"
      loading="eager"
      shellClassName="route-embed-shell-fill-parent"
    />
  );

  // v1 backdoor: bare legacy embed, no v5 shell (HARD: V1 reachable byte-intact).
  if (version === "v1") return frame;

  return (
    <div className="fnk-shell">
      <AppShell active="stockAnalyzer" title="Stock Analyzer" backHref={ROUTES.explore}>
        {frame}
      </AppShell>
    </div>
  );
}
