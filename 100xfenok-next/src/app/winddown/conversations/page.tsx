import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownVoiceReportHistory from "@/features/winddown/voice/ui/WindDownVoiceReportHistory";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";
export const revalidate = false;

export const metadata: Metadata = {
  title: "대화 보관함 · WIND DOWN",
  description: "저장된 역할 대화와 자유 대화 기록을 확인해요.",
  robots: { index: false, follow: false },
};

export default async function WindDownConversationsPage() {
  const cookieStore = await cookies();
  const authenticated = await verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );

  if (!authenticated) {
    return (
      <div data-immersive-route="winddown-conversations">
        <AdminAccessGate />
      </div>
    );
  }

  return (
    <div data-immersive-route="winddown-conversations">
      <WindDownVoiceReportHistory />
    </div>
  );
}
