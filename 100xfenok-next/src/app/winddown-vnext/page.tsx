import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Fraunces } from "next/font/google";
import AdminAccessGate from "@/components/AdminAccessGate";
import MonaVoiceCoachApp from "@/features/mona-vnext/MonaVoiceCoachApp";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-wd-serif",
});

export const metadata: Metadata = {
  title: "Mona vNext",
  description: "격리된 Mona Wind-Down vNext 테스트",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f3ea",
  viewportFit: "cover",
};

export default async function WindDownVnextPage() {
  const cookieStore = await cookies();
  const authenticated = await verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );

  if (!authenticated) {
    return <AdminAccessGate />;
  }

  return (
    <div className={fraunces.variable}>
      <MonaVoiceCoachApp />
    </div>
  );
}
