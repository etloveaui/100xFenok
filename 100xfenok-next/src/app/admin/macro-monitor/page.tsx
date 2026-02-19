import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Macro Monitor",
  description: "100xFenok 매크로 모니터 관리자 페이지",
};

export default function AdminMacroMonitorPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/admin/market-radar/index.html"
        title="100x Admin Macro Monitor"
        className="h-full w-full border-0"
      />
    </div>
  );
}
