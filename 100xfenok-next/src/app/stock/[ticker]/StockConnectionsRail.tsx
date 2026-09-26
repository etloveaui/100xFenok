"use client";

import { useEffect, useState } from "react";
import ConnectedView from "@/components/connected/ConnectedView";
import {
  getStockConnection,
  getStockServices,
  loadStockConnectionIndex,
  loadStockServicesIndex,
  type StockConnectionEntry,
  type StockServicesEntry,
} from "@/lib/data-entity-graph/stock-index";

/**
 * 데이터 연결: where this ticker shows up across the product (filings, 13F
 * holders, index membership, single-stock ETFs) with each dataset's date.
 * It used to exist only inside the top-bar search preview drawer, one step
 * before the stock page; it now sits on the page itself. The two indexes are
 * the ones the screener and portfolio already load (force-cache, ~51KB gzip).
 */
export default function StockConnectionsRail({ ticker }: { ticker: string }) {
  const [entry, setEntry] = useState<StockConnectionEntry | null | undefined>(undefined);
  const [services, setServices] = useState<StockServicesEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    Promise.all([
      loadStockConnectionIndex(controller.signal),
      loadStockServicesIndex(controller.signal),
    ]).then(([stockIndex, servicesIndex]) => {
      if (cancelled) return;
      setEntry(getStockConnection(stockIndex, ticker));
      setServices(getStockServices(servicesIndex, ticker));
    }).catch(() => {
      if (cancelled) return;
      setEntry(null);
      setServices(null);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ticker]);

  return (
    <div data-stock-connections>
      <ConnectedView ticker={ticker} entry={entry} services={services} variant="page" />
    </div>
  );
}
