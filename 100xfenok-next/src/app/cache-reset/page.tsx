import type { Metadata } from "next";
import CacheResetClient from "./CacheResetClient";

export const dynamic = "force-dynamic";
export const revalidate = false;

export const metadata: Metadata = {
  title: "Cache reset | FenoK",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CacheResetPage() {
  return <CacheResetClient />;
}
