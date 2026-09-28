import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownGameClient from "@/features/winddown/game/ui/WindDownGameClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "World Tour · Wind-Down",
  description: "공부해서 나아가는 WIND DOWN 월드투어",
  robots: { index: false, follow: false },
};

export default async function WindDownGamePage() {
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
      <WindDownGameClient />
    </div>
  );
}
