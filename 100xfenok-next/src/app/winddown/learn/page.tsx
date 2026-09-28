import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownLearnClient from "@/features/winddown/ui/WindDownLearnClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "Learn · Wind-Down",
  description: "모델 없이 다섯 문장을 배우는 WIND DOWN 학습",
  robots: { index: false, follow: false },
};

export default async function WindDownLearnPage() {
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
      <WindDownLearnClient />
    </div>
  );
}
