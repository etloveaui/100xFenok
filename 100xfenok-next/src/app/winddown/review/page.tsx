import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownReviewClient from "@/features/winddown/ui/WindDownReviewClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "Review · Wind-Down",
  description: "모델 없이 간격이 온 문장을 회복하는 WIND DOWN 복습",
  robots: { index: false, follow: false },
};

export default async function WindDownReviewPage() {
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
      <WindDownReviewClient />
    </div>
  );
}
