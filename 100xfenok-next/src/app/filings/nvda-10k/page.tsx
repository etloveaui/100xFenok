import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "NVDA 10-K 자동 요약 파일럿 | 100xFenok",
  description: "NVDA 10-K 공시를 기반으로 만든 AI 자동 생성 한글 요약 파일럿입니다.",
};

export default function Nvda10kFilingSummaryPage() {
  redirect("/stock/NVDA?tab=filings");
}
