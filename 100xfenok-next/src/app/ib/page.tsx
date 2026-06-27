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
  // Immersive (chrome-less full-screen) route: suppress the legacy V1 GNB navbar
  // + footer that otherwise leak in on top of the IB app's own header. The
  // [data-immersive-route] hook drives the hide rules in globals.css. Covers
  // both the V1 iframe embed and the V2 native preview; server-rendered, no flash.
  //
  // Owner decision (2026-06-28): /ib defaults to the complete V1 app. The V2
  // native port is NOT yet feature-equivalent (missing login/Sheets sync,
  // profile + ticker CRUD, editable inputs, order copy, cash reserve), so V2 is
  // gated behind an explicit ?v2=1 preview opt-in until it reaches parity.
  // ?v1=1 (global V1 backdoor) keeps winning and also resolves to V1.
  const v2Param = Array.isArray(params.v2) ? params.v2[0] : params.v2;
  const showV2Native = v2Param === "1" && version !== "v1";
  return (
    <div data-immersive-route="ib" style={{ display: "contents" }}>
      {showV2Native ? <IbV2Client /> : <IbV1Embed />}
    </div>
  );
}
