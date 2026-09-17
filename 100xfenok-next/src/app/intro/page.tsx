import type { Metadata } from "next";
import IntroClient from "./IntroClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "100x Fenok — Intro",
  description: "100배 빠른 시장 통찰, 데이터가 말하는 시장의 체온",
  robots: {
    index: false,
    follow: false,
  },
};

export default function IntroPage() {
  return <IntroClient />;
}
