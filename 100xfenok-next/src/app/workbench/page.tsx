import type { Metadata } from "next";
import WorkbenchView from "@/components/workbench/WorkbenchView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Workbench",
  description: "시장 신호·체온계·일정·섹터·종목까지 — 오늘 시장을 30초에 파악하는 대시보드.",
};

export default function WorkbenchPage() {
  return <WorkbenchView />;
}
