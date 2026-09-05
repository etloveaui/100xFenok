import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import SuperinvestorsClient from "./SuperinvestorsClient";
import "./superinvestors-light.css";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "기관 공시 인텔리전스 | 100xFenok",
  description: "주요 투자자의 분기 공시 보유, 공통 보유, 종목–투자자 그래프를 탐색합니다.",
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SuperinvestorsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const initialGuru = firstParam(params.guru).trim();
  const initialTab = firstParam(params.tab).trim();
  const initialTicker = firstParam(params.ticker).trim().toUpperCase();
  return (
    <div className="fnk-shell">
      <AppShell active="superinvestors" title="투자자">
        <SuperinvestorsClient initialGuru={initialGuru || null} initialTab={initialTab || null} initialTicker={initialTicker || null} />
      </AppShell>
    </div>
  );
}
