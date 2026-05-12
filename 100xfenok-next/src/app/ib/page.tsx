import type { Metadata } from "next";
import IbV1Embed from "./IbV1Embed";
import IbV2Client from "./IbV2Client";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";

export const metadata: Metadata = {
  title: "IB Helper",
  description: "Infinite Buying Helper full application",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * IB Helper route. Server shell branches between:
 * - V1 (default): vanilla HTML embed via RouteEmbedFrame (production-shipped).
 * - V2 (`?v2=1`): native React light theme port — dual ticker (TQQQ + SOXL)
 *   first-class, Cash inset alert (no sticky banner), profile picker as
 *   bottom sheet. Mock data for now; live data wiring deferred to BACKLOG.
 *
 * Plan: docs/design-handoff/2026-05-12-ib-helper-light-v2/project/handoff/README.md
 */
export default async function IBPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const version = getDesignVersionFromSearchParams(params);
  if (version === "v2" || version === "v3" || version === "v4") {
    return <IbV2Client />;
  }
  return <IbV1Embed />;
}
