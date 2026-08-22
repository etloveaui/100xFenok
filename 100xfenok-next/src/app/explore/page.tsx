import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "워크벤치 | 100xFenok",
  description: "워크벤치 화면으로 이동합니다.",
};

// /explore rendered the same WorkbenchView as /workbench with only a surface prop
// differing, so it was a duplicate URL for one screen. The rail's 홈 item never
// pointed here (EXPLORE_ROUTE is the home route), leaving this reachable only from
// two orphaned links. Redirecting keeps those working while removing the duplicate.
export default function ExplorePage() {
  permanentRedirect(ROUTES.workbench);
}
