"use client";

import dynamic from "next/dynamic";

function CpScreenerTanstackLoading() {
  return (
    <div className="cp-screener-lab" data-canvas-plus-screener-tanstack-loading>
      <p className="cp-lab__eyebrow">CANVAS+ V3 SCREENER TANSTACK</p>
      <h1 className="cp-lab__title">TanStack Table comparison route</h1>
      <p className="cp-lab__summary">Loading the client-only TanStack table...</p>
    </div>
  );
}

const CpScreenerTanstackLab = dynamic(() => import("@/components/canvas-plus/CpScreenerTanstackLab"), {
  ssr: false,
  loading: CpScreenerTanstackLoading,
});

export default function CpScreenerTanstackLabClient() {
  return <CpScreenerTanstackLab />;
}
