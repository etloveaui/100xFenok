import type { Metadata } from "next";
import HomeV5Client from "../HomeV5Client";
import { BRIEFING_META_TITLE } from "@/lib/product-nav";

export const metadata: Metadata = {
  title: BRIEFING_META_TITLE,
  description: "선별장세·시장 펄스·리드 스토리 중심의 100xFenok 브리핑 보드.",
};

export default function BriefingPage() {
  return <HomeV5Client />;
}
