import type { Metadata } from "next";
import ProductSurfaceCoverageCard from "@/components/data/ProductSurfaceCoverageCard";
import MarketQuickLinks from "@/components/market/MarketQuickLinks";
import AppShell from "@/components/shell/AppShell";
import EtfUniverseCard from "../explore/EtfUniverseCard";
import type { EtfTypeFilter } from "../explore/etfUniverseUtils";
import EtfSurfaceSnapshotCard from "./EtfSurfaceSnapshotCard";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "ETF 센터 | 100xFenok",
  description: "ETF 목록, 신규 상장, 디지털자산, 레버리지·단일종목 ETF를 확인합니다.",
};

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

function digitalOnlyFromParams(params: Record<string, string | string[] | undefined>): boolean {
  const rawDigital = params.digital;
  const value = Array.isArray(rawDigital) ? rawDigital[0] : rawDigital;
  return value === "1" || value === "true";
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EtfsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const initialTypeFilter = typeFilterFromParams(params);
  const initialDigitalOnly = digitalOnlyFromParams(params);
  const initialNewOnly = initialDigitalOnly ? false : newOnlyFromParams(params);

  return (
    <div className="fnk-shell">
      <AppShell active="etfs" title="ETF">
        <section className="panel">
          <div className="data-shell-header">
            <div className="data-shell-head-main">
              <p className="data-shell-kicker">ETF</p>
              <h1 className="data-shell-title">ETF 센터</h1>
              <p className="data-shell-desc">
                ETF 목록, 신규 상장, 디지털자산, 레버리지·단일종목 ETF를 한곳에서 확인합니다.
              </p>
            </div>
            <div className="data-shell-head-actions">
              <MarketQuickLinks />
            </div>
          </div>
        </section>

        <div className="mt-[var(--s4)]">
          <ProductSurfaceCoverageCard surfaceId="etf_center" />
        </div>

        <div className="mt-[var(--s4)]">
          <EtfSurfaceSnapshotCard />
        </div>

        <div className="mt-[var(--s4)]">
          <EtfUniverseCard
            limit={100}
            showOpenLink={false}
            initialTypeFilter={initialTypeFilter}
            initialNewOnly={initialNewOnly}
            initialDigitalOnly={initialDigitalOnly}
            initialAssetClassFilter={firstParam(params.asset) ?? "전체"}
            initialIssuerFilter={firstParam(params.issuer) ?? "전체"}
            initialAumFilter={firstParam(params.aum)}
            initialExpenseFilter={firstParam(params.fee)}
            syncTypeParam
            enableLoadMore
          />
        </div>
      </AppShell>
    </div>
  );
}
