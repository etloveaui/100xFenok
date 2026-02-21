import type { Metadata } from "next";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";

export const metadata: Metadata = {
  title: "100x Daily Wrap",
  description: "데일리 마켓 브리핑과 아카이브",
};

export default function DailyWrapPage() {
  return <RouteEmbedFrame src="/100x/daily-wrap/daily-wrap-viewer.html" title="100x Daily Wrap" loading="eager" />;
}
