import type { Metadata } from "next";
import { cookies } from "next/headers";
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
 * - V5/default: native React light theme port — dual ticker (TQQQ + SOXL)
 *   first-class, Cash inset alert (no sticky banner), profile picker as
 *   bottom sheet. Mock data for now; live data wiring deferred to BACKLOG.
 * - V1 (`?v1=1` or persisted v1): vanilla HTML embed via RouteEmbedFrame.
 *
 * Plan: docs/design-handoff/2026-05-12-ib-helper-light-v2/project/handoff/README.md
 */
export default async function IBPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );
  if (version !== "v1") {
    return <IbV2Client />;
  }
  return <IbV1Embed />;
}
