import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { normalizeForEntityKey } from "@/lib/ticker";
import PortfolioClient from "./PortfolioClient";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "포트폴리오 | 100xFenok",
  description: "내 포트폴리오를 기기 내에서 관리합니다. 서버 전송 없음.",
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function PortfolioPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const initialTicker = normalizeForEntityKey(firstParam(params.ticker));

  return (
    <div className="fnk-shell">
      <AppShell active="portfolio" title="포트폴리오">
        <PortfolioClient initialTicker={initialTicker} />
      </AppShell>
    </div>
  );
}
