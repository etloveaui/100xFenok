"use client";

import { useState } from "react";
import AppShell from "@/components/shell/AppShell";
import type { DataState } from "@/lib/data-state";
import { ROUTES } from "@/lib/routes";
import MarketValuationClient from "./MarketValuationClient";

export default function MarketValuationShell() {
  const [freshness, setFreshness] = useState<DataState | null>(null);

  return (
    <AppShell active="market" title="시장" backHref={ROUTES.home} freshness={freshness}>
      <MarketValuationClient onFreshnessChange={setFreshness} />
    </AppShell>
  );
}
