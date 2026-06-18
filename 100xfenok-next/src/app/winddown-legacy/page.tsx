import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Fraunces } from "next/font/google";
import AdminAccessGate from "@/components/AdminAccessGate";
import AdminLiveBench from "@/components/admin-live/AdminLiveBench";
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
  title: "Wind-Down Legacy",
  description: "자기 전 영어 발화 코치 레거시 롤백 경로",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf6ef",
  viewportFit: "cover",
};

export default async function WindDownLegacyPage() {
  const cookieStore = await cookies();
  const authenticated = await verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );

  if (!authenticated) {
    return (
      <div data-immersive-route="winddown-legacy" className={fraunces.variable}>
        <AdminAccessGate />
      </div>
    );
  }

  return (
    <div data-immersive-route="winddown-legacy" className={fraunces.variable}>
      <AdminLiveBench initialMode="mona" simpleUi />
    </div>
  );
}
