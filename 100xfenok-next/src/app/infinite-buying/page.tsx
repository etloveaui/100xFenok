import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import AppShell from '@/components/shell/AppShell';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import TransitionLink from '@/components/TransitionLink';
import { getDesignVersionFromSearchParams } from '@/lib/design/version';
import { ROUTES } from '@/lib/routes';

export const metadata: Metadata = {
  title: 'Infinite Buying',
  description: 'TQQQ·SOXL 분할매수를 자동 계산해 주는 가이드',
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InfiniteBuyingPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );
  const frame = (
    <RouteEmbedFrame
      src="/ib/ib-total-guide-calculator.html"
      title="Infinite Buying Guide"
      loading="eager"
      shellClassName={version === "v1" ? undefined : "route-embed-shell-app"}
    />
  );

  if (version === "v1") return frame;

  return (
    <div className="fnk-shell">
      <AppShell active="ib" title="Infinite Buying" backHref={ROUTES.home}>
        <div
          className="flex min-h-0 flex-col gap-3"
          data-infinite-buying-surface="true"
          data-infinite-buying-route-owner="legacy-guide-calculator"
        >
          <section
            className="rounded-[var(--panel-r)] border border-slate-200 bg-white px-3 py-3 shadow-sm"
            data-infinite-buying-boundary="true"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-700">
                  Infinite Buying
                </p>
                <h1 className="text-base font-black text-slate-950 sm:text-lg">Guide 계산기</h1>
                <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-600 sm:text-sm">
                  이 경로는 완성된 레거시 가이드 계산기를 보존합니다. 운용 Helper와 native preview는 IB Helper에서 분리해 확인합니다.
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.08em]">
                  <span
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600"
                    data-infinite-buying-boundary-chip="legacy-guide"
                  >
                    legacy guide
                  </span>
                  <span
                    className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700"
                    data-infinite-buying-boundary-chip="ib-helper-owner"
                  >
                    ib helper owner
                  </span>
                  <span
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700"
                    data-infinite-buying-boundary-chip="native-preview"
                  >
                    native preview
                  </span>
                </div>
              </div>
              <nav
                className="grid min-w-[min(100%,24rem)] grid-cols-1 gap-2 sm:grid-cols-3"
                aria-label="Infinite Buying 관련 경로"
              >
                <TransitionLink
                  href={ROUTES.ib}
                  className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
                  data-infinite-buying-owner-link="ib-helper"
                >
                  IB Helper
                </TransitionLink>
                <TransitionLink
                  href={`${ROUTES.ib}?v2=1`}
                  className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
                  data-infinite-buying-owner-link="native-preview"
                >
                  V2 미리보기
                </TransitionLink>
                <TransitionLink
                  href={ROUTES.vr}
                  className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
                  data-infinite-buying-owner-link="vr-calculator"
                >
                  VR 계산기
                </TransitionLink>
              </nav>
            </div>
          </section>
          <div className="min-h-0" data-infinite-buying-legacy-frame="true">
            {frame}
          </div>
        </div>
      </AppShell>
    </div>
  );
}
