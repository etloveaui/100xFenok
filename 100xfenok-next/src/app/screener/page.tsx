import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import ScreenerClient from "./ScreenerClient";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "종목 스크리너 | 100xFenok",
  description: "글로벌 1,066개 종목을 PER·PBR·배당·12개월 수익률로 거르고 줄세우는 스크리너.",
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function ScreenerPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const initialSearch = firstParam(params.ticker ?? params.q).trim().toUpperCase();
  return (
    <div className="fnk-shell">
      <AppShell active="screener" title="스크리너">
        <ScreenerClient initialSearch={initialSearch} />
      </AppShell>
    </div>
  );
}
