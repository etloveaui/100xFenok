import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { ROUTES } from "@/lib/routes";
import ResearchClient from "./ResearchClient";

export const metadata: Metadata = {
  title: "리서치",
  description: "기업 리서치 아티팩트와 제품 브리프를 모은 목록",
};

export default function ResearchPage() {
  return (
    <div className="fnk-shell">
      <AppShell active="research" title="리서치" backHref={ROUTES.home}>
        <ResearchClient />
      </AppShell>
    </div>
  );
}
