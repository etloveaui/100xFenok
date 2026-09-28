import type { Metadata } from "next";
import { Suspense } from "react";
import IntroClient from "./IntroClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "100xFenok",
  description: "화면 13개. 미국·한국 시장 데이터를 매일 자동으로 갱신합니다.",
  robots: { index: false, follow: false },
};

export default function IntroPage() {
  return (
    <Suspense fallback={<div className="intro-root min-h-[100svh] w-full" aria-hidden="true" />}>
      <IntroClient />
    </Suspense>
  );
}
