import type { Metadata } from "next";
import WorkbenchView from "@/components/workbench/WorkbenchView";
import { EXPLORE_META_TITLE } from "@/lib/product-nav";

export const metadata: Metadata = {
  title: EXPLORE_META_TITLE,
  description: "시장 신호·체온계·일정·섹터·종목까지 — 오늘 시장을 30초에 파악하는 대시보드.",
};

export default function ExplorePage() {
  return <WorkbenchView />;
}
