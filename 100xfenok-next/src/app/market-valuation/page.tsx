import type { Metadata } from "next";
import MarketValuationClient from "./MarketValuationClient";

export const metadata: Metadata = {
  title: "시장 밸류에이션 | 100xFenok",
  description: "S&P500·나스닥·러셀 등 주요 미국 지수가 역사적으로 비싼지/싼지 — Fwd P/E·P/B 16년 밴드 대조.",
};

export default function MarketValuationPage() {
  return <MarketValuationClient />;
}
