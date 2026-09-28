"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentProps } from "react";
import { Skeleton } from "@/components/ui/Skeleton";

function ScreenerLoadingSkeleton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShow(true), 120);
    return () => window.clearTimeout(timer);
  }, []);
  // Reserve the screener shell's space from the first paint; only the
  // skeleton's visibility waits for the 120 ms delay (anti-flash kept).
  // The min-height applies at <=920px only (the screener's mobile/desktop
  // split, cp-w4-screener.css:564-583); 1440 measured 0.00 today, so the
  // desktop side gets no reservation. [hypothesis] value: the <=920 shell is
  // the list capped at 70vh plus chrome.
  return (
    <div
      role="status"
      aria-live="polite"
      data-screener-loading="true"
      className="max-[920px]:min-h-[70vh] transition-opacity duration-150"
      style={{ opacity: show ? 1 : 0 }}
      aria-hidden={show ? undefined : true}
    >
      <Skeleton />
    </div>
  );
}

const ScreenerClient = dynamic(() => import("./ScreenerClient"), {
  ssr: false,
  loading: () => <ScreenerLoadingSkeleton />,
});

export type ScreenerClientLoaderProps = ComponentProps<typeof ScreenerClient>;

export default function ScreenerClientLoader(props: ScreenerClientLoaderProps) {
  return <ScreenerClient {...props} />;
}
