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
  if (!show) return null;
  return (
    <div role="status" aria-live="polite" data-screener-loading="true">
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
