import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownVoiceClient from "@/features/winddown/voice/ui/WindDownVoiceClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "Roleplay · Wind-Down",
  description: "짧은 장면으로 말해보는 WIND DOWN 역할 대화",
  robots: { index: false, follow: false },
};

export default async function WindDownRoleplayPage() {
  const cookieStore = await cookies();
  const authenticated = await verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );

  if (!authenticated) {
    return (
      <div data-immersive-route="winddown-roleplay">
        <AdminAccessGate />
      </div>
    );
  }

  return (
    <div data-immersive-route="winddown-roleplay">
      <WindDownVoiceClient activity="roleplay" />
    </div>
  );
}
