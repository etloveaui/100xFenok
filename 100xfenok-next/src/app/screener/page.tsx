import type { Metadata } from "next";
import ScreenerClient from "./ScreenerClient";

export const metadata: Metadata = {
  title: "종목 스크리너 | 100xFenok",
  description: "글로벌 1,066개 종목을 PER·PBR·배당·12개월 수익률로 거르고 줄세우는 스크리너.",
};

export default function ScreenerPage() {
  return <ScreenerClient />;
}
