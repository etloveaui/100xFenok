import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownDrillClient from "@/features/winddown/drill/ui/WindDownDrillClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "Quick Drill · Wind-Down",
  description: "다섯 라운드와 회상·듣기·말하기를 이어가는 WIND DOWN 문장 연습",
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
      <Suspense fallback={<p role="status" className="p-6 text-center">연습을 준비하고 있어.</p>}>
        <WindDownDrillClient />
      </Suspense>
    </div>
  );
}
