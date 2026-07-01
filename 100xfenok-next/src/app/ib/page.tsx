import type { Metadata } from "next";
import { cookies } from "next/headers";
import IbV1Embed from "./IbV1Embed";
import IbV2Client from "./IbV2Client";
import TransitionLink from "@/components/TransitionLink";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "IB Helper (레거시) | 100xFenok",
  description: "완성된 V1 IB Helper와 네이티브 V2 미리보기 경계를 분리한 무한매수 도우미",
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

  if (showV2Native) {
    return (
      <div data-immersive-route="ib" style={{ display: "contents" }}>
        <IbV2Client />
      </div>
    );
  }

  if (version === "v1") {
    return (
      <div data-immersive-route="ib" style={{ display: "contents" }}>
        <IbV1Embed />
      </div>
    );
  }

  return (
    <div
      className="flex h-screen h-[100dvh] flex-col bg-slate-50"
      data-immersive-route="ib"
      data-ib-surface="true"
      data-ib-route-owner="legacy-v1"
    >
      <section className="border-b border-slate-200 bg-white px-3 py-3 shadow-sm" data-ib-boundary="true">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-700">IB Helper</p>
            <h1 className="text-base font-black text-slate-950 sm:text-lg">IB Helper (레거시)</h1>
            <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-600 sm:text-sm">
              기본 경로는 완성된 V1 앱입니다. 네이티브 V2는 기능 동등성이 끝날 때까지 명시 preview로만 유지합니다.
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.08em]">
              <span
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600"
                data-ib-boundary-chip="legacy-v1"
              >
                legacy v1
              </span>
              <span
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700"
                data-ib-boundary-chip="native-v2-preview"
              >
                native v2 preview
              </span>
              <span
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700"
                data-ib-boundary-chip="v1-backdoor"
              >
                v1 backdoor
              </span>
            </div>
          </div>
          <nav className="grid min-w-[min(100%,24rem)] grid-cols-1 gap-2 sm:grid-cols-3" aria-label="IB Helper 경로">
            <TransitionLink
              href={`${ROUTES.ib}?v2=1`}
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
              data-ib-owner-link="native-v2-preview"
            >
              V2 미리보기
            </TransitionLink>
            <TransitionLink
              href="/admin/ib-helper"
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
              data-ib-owner-link="admin-helper"
            >
              Admin Helper
            </TransitionLink>
            <TransitionLink
              href={ROUTES.infiniteBuying}
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
              data-ib-owner-link="guide-calculator"
            >
              Guide 계산기
            </TransitionLink>
          </nav>
        </div>
      </section>
      <div className="min-h-0 flex-1" data-ib-legacy-frame="true">
        <IbV1Embed shellClassName="route-embed-shell-fill-parent" />
      </div>
    </div>
  );
}
