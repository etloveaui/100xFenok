import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { ROUTES } from "@/lib/routes";
import ChangesClient from "./ChangesClient";

export const metadata: Metadata = {
  title: "무엇이 바뀌었나 | 100xFenok",
  description: "컨센서스 리비전, 13F 보유자 변화, Edge 점수 변화를 한 페이지에서 확인합니다.",
};

export default function ChangesPage() {
  return (
    <div className="fnk-shell">
      <AppShell title="무엇이 바뀌었나" backHref={ROUTES.home}>
        <ChangesClient />
      </AppShell>
    </div>
  );
}
