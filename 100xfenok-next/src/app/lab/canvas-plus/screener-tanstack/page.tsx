import type { Metadata } from "next";

import CpScreenerTanstackLabClient from "@/components/canvas-plus/CpScreenerTanstackLabClient";

export const metadata: Metadata = {
  title: "CANVAS+ TanStack Screener Lab | 100xFenok",
  description: "CANVAS+ V3 TanStack Table screener density proof of concept.",
  robots: { index: false, follow: false },
};

export default function CanvasPlusScreenerTanstackPage() {
  return (
    <div className="canvas-plus" data-canvas-plus data-canvas-plus-screener-tanstack-page>
      <main className="cp-lab">
        <CpScreenerTanstackLabClient />
      </main>
    </div>
  );
}
