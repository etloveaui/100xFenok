import type { Metadata } from "next";
import { Suspense } from "react";
import IntroClient from "./IntroClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "100x Market Radar",
  description: "미국 시장을 숫자로 먼저 봅니다. S&P 500과 나스닥, 11개 섹터의 등락과 회전을 매일 갱신합니다.",
  robots: { index: false, follow: false },
};

export default function IntroPage() {
  return (
    <Suspense fallback={<div className="min-h-[100svh] w-full bg-[#08090a]" aria-hidden="true" />}>
      <IntroClient />
    </Suspense>
  );
}
