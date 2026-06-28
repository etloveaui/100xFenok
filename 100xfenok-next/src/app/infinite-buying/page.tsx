import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import AppShell from '@/components/shell/AppShell';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
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
        {frame}
      </AppShell>
    </div>
  );
}
