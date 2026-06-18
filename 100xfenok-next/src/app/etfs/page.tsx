import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import EtfUniverseCard from "../explore/EtfUniverseCard";
import type { EtfTypeFilter } from "../explore/etfUniverseUtils";
import EtfSurfaceSnapshotCard from "./EtfSurfaceSnapshotCard";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "ETF 센터 | 100xFenok",
  description: "ETF 목록, 신규 상장, 레버리지·단일종목 ETF를 확인합니다.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

function typeFilterFromParams(params: Record<string, string | string[] | undefined>): EtfTypeFilter {
  const rawType = params.type;
  const type = Array.isArray(rawType) ? rawType[0] : rawType;
  if (type === "leveraged") return "레버리지";
  if (type === "single-stock") return "단일종목 레버리지";
  if (type === "inverse") return "인버스";
  return "전체";
}

function newOnlyFromParams(params: Record<string, string | string[] | undefined>): boolean {
  const rawNew = params.new;
  const value = Array.isArray(rawNew) ? rawNew[0] : rawNew;
  return value === "1" || value === "true";
}

export default async function EtfsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const initialTypeFilter = typeFilterFromParams(params);
  const initialNewOnly = newOnlyFromParams(params);

  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="etfs" title="ETF">
        <section className="panel">
          <div className="data-shell-header">
            <div className="data-shell-head-main">
              <p className="data-shell-kicker">ETF 센터</p>
              <h1 className="data-shell-title">ETF 센터</h1>
              <p className="data-shell-desc">
                ETF 목록, 신규 상장, 레버리지·단일종목 ETF를 한곳에서 확인합니다.
              </p>
            </div>
            <div className="data-shell-head-actions">
              <TransitionLink href="/etfs/new" className="data-shell-pill ok"><span />신규 상장</TransitionLink>
            </div>
          </div>
        </section>

        <div style={{ marginTop: "var(--s4)" }}>
          <EtfSurfaceSnapshotCard />
        </div>

        <div style={{ marginTop: "var(--s4)" }}>
          <EtfUniverseCard limit={100} showOpenLink={false} initialTypeFilter={initialTypeFilter} initialNewOnly={initialNewOnly} syncTypeParam enableLoadMore />
        </div>
      </AppShell>
    </div>
  );
}
