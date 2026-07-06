import type { Metadata } from "next";

import CpScreenerNativeLab from "@/components/canvas-plus/CpScreenerNativeLab";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CANVAS+ Native Screener Lab | 100xFenok",
  description: "CANVAS+ V3 native screener density proof of concept.",
  robots: { index: false, follow: false },
};

export default function CanvasPlusScreenerNativePage() {
  return (
    <div className="canvas-plus" data-canvas-plus data-canvas-plus-screener-native-page>
      <main className="cp-lab">
        <CpScreenerNativeLab />
      </main>
    </div>
  );
}
