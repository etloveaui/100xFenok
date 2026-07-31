import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownVoiceClient from "@/features/winddown/voice/ui/WindDownVoiceClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "Live Talk · Wind-Down",
  description: "점수 없이 편안하게 말하는 WIND DOWN 라이브 대화",
  robots: { index: false, follow: false },
};

export default async function WindDownLiveTalkPage() {
  const cookieStore = await cookies();
  const authenticated = await verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );

  if (!authenticated) {
    return (
      <div data-immersive-route="winddown-live-talk">
        <AdminAccessGate />
      </div>
    );
  }

  return (
    <div data-immersive-route="winddown-live-talk">
      <WindDownVoiceClient activity="live-talk" />
    </div>
  );
}
