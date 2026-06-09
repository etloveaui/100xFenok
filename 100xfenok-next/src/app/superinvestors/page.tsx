import type { Metadata } from "next";
import SuperinvestorsClient from "./SuperinvestorsClient";

export const metadata: Metadata = {
  title: "13F Superinvestors | 100xFenok",
  description: "30개 슈퍼인베스터의 13F 보유 데이터를 탐색합니다. 컨센서스, 구루 포트폴리오, 종목별 보유 현황.",
};

export default function SuperinvestorsPage() {
  return <SuperinvestorsClient />;
}
