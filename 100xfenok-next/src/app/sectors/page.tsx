import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { ROUTES } from "@/lib/routes";
import SectorsClient from "./SectorsClient";
import "@/styles/cp-w5-sectors.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "섹터 히트맵 | 100xFenok",
  description: "11개 미국 업종의 다기간 성과 히트맵, 강·약 순위, 섹터 ETF 비교.",
};

export default function SectorsPage() {
  return (
    <div className="fnk-shell">
      <AppShell active="sectors" title="섹터" backHref={ROUTES.home}>
        <SectorsClient />
      </AppShell>
    </div>
  );
}
