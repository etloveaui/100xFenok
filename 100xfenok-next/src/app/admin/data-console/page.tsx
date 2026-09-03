import type { Metadata } from "next";
import DataConsoleClient from "./DataConsoleClient";

export const metadata: Metadata = {
  title: "데이터 건강 콘솔 | 100xFenok",
  description: "레인별 신선도와 증거 서랍을 모은 관리자 데이터 건강 콘솔",
};

export default function AdminDataConsolePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
      <DataConsoleClient />
    </main>
  );
}
