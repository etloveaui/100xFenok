import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/server/admin-session";
import WindDownRecordsClient from "@/features/winddown/ui/WindDownRecordsClient";

export const metadata: Metadata = {
  title: "학습 기록 보관 · WIND DOWN",
  robots: { index: false, follow: false },
};

export default async function WindDownRecordsPage() {
  const store = await cookies();
  const authenticated = await verifyAdminSessionToken(store.get(ADMIN_SESSION_COOKIE)?.value);
  return <div data-immersive-route="winddown">{authenticated ? <WindDownRecordsClient /> : <AdminAccessGate />}</div>;
}
