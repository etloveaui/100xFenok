import type { Metadata } from "next";
import PortfolioClient from "./PortfolioClient";

export const metadata: Metadata = {
  title: "포트폴리오 | 100xFenok",
  description: "내 포트폴리오를 기기 내에서 관리합니다. 서버 전송 없음.",
};

export default function PortfolioPage() {
  return (
    <main className="container mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
      <PortfolioClient />
    </main>
  );
}
