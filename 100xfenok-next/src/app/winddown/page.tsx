import type { Metadata } from "next";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownHabitHomeClient from "@/features/winddown/habit/ui/WindDownHabitHomeClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

// --font-wd-serif is defined with the other self-hosted faces in
// ../fonts/fonts.css; next/font/google was removed repo-wide.

export const metadata: Metadata = {
  title: "Wind-Down",
  description: "자기 전 영어 여정",
  manifest: "/winddown/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Wind-Down",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [{ url: "/winddown/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};

export default async function WindDownPage() {
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
      <WindDownHabitHomeClient />
    </div>
  );
}
