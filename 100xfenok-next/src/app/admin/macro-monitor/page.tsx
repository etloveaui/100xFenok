import type { Metadata } from "next";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";

export const metadata: Metadata = {
  title: "Admin · Macro Monitor",
  description: "100xFenok 매크로 모니터 관리자 페이지",
};

export default function AdminMacroMonitorPage() {
  return <RouteEmbedFrame src="/admin/market-radar/index.html" title="100x Admin Macro Monitor" loading="eager" />;
}
