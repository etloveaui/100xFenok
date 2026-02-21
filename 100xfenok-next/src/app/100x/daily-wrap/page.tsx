import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "100x Daily Wrap",
  description: "데일리 마켓 브리핑과 아카이브",
};

export default function DailyWrapPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/100x/daily-wrap/daily-wrap-viewer.html"
        title="100x Daily Wrap"
        loading="eager"
        className="h-full w-full border-0"
      />
    </div>
  );
}
