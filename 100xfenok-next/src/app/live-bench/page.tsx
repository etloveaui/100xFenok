import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Voice Lab | 100xFenok",
  description: "인증된 관리자용 음성 콘솔로 이동합니다.",
  robots: { index: false, follow: false },
};

export default function PublicLiveBenchPage() {
  redirect("/admin/live");
}
