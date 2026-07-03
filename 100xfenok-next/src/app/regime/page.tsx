import type { Metadata } from "next";

import AppShell from "@/components/shell/AppShell";
import "@/styles/cp-w5-regime.css";
import RegimeClient from "./RegimeClient";

export const metadata: Metadata = {
  title: "시장 국면 | 100xFenok",
  description: "시장 구조, 경기, 투자심리, 밸류에이션 신호를 한 화면에서 확인합니다.",
};

export default function RegimePage() {
  return (
    <div className="fnk-shell">
      <AppShell active="regime" title="시장 국면">
        <RegimeClient />
      </AppShell>
    </div>
  );
}
