import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownDrillClient from "@/features/winddown/drill/ui/WindDownDrillClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "Quick Drill · Wind-Down",
  description: "점수와 콤보로 다섯 라운드를 푸는 모델 없는 WIND DOWN 연습",
  robots: { index: false, follow: false },
};

export default async function WindDownDrillPage() {
  const cookieStore = await cookies();
  const authenticated = await verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );

  if (!authenticated) {
    return (
      <div data-immersive-route="winddown">
        <AdminAccessGate />
      </div>
    );
  }

  return (
    <div data-immersive-route="winddown">
      <WindDownDrillClient />
    </div>
  );
}
