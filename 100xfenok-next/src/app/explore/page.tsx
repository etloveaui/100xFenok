import type { Metadata } from "next";
import WorkbenchView from "@/components/workbench/WorkbenchView";
import { EXPLORE_META_TITLE } from "@/lib/product-nav";

export const metadata: Metadata = {
  title: EXPLORE_META_TITLE,
  description: "시장 신호·체온계·일정·섹터·종목까지 오늘 시장을 30초에 훑는 탐색 화면.",
};

export default function ExplorePage() {
  return <WorkbenchView surface="explore" />;
}
