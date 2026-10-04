import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { ROUTES } from "@/lib/routes";
import FilingsDirectoryClient from "./FilingsDirectoryClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "공시 한글 요약",
  description: "수집된 SEC 공시 한글 요약을 종목별로 찾아봅니다.",
};

export default function FilingsDirectoryPage() {
  return <AppShell active="research" title="공시 한글 요약" backHref={ROUTES.research}>
    <FilingsDirectoryClient />
  </AppShell>;
}
