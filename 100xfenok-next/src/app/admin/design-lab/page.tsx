import type { Metadata } from "next";
import Link from "next/link";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import DesignLabProfilePreview from "@/components/DesignLabProfilePreview";
import HomeDesignPreview from "@/components/HomeDesignPreview";
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from "@/lib/server/legacy-bridge";

export const metadata: Metadata = {
  title: "Admin · Design Lab",
  description: "100xFenok 디자인 실험실",
};

interface PageProps {
  searchParams?: Promise<{ path?: string | string[]; mode?: string | string[] }>;
}

export default async function AdminDesignLabPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = getSingleSearchParam(params.path);
  const mode = getSingleSearchParam(params.mode);
  const isNativeMode = mode === "native";
  const isHomePreviewMode = mode === "home-preview";
  const isHomePreviewStrongMode = mode === "home-preview-strong";

  if (isHomePreviewMode || isHomePreviewStrongMode) {
    return (
      <main className="container mx-auto px-4 py-4">
        <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                {isHomePreviewStrongMode ? "Design Lab Stronger Preview" : "Design Lab Home Preview"}
              </p>
              <p className="text-sm text-slate-600">
                {isHomePreviewStrongMode
                  ? "기존 A/B/C보다 더 강한 카드안만 바로 보도록 정리한 전용 진입입니다."
                  : "메인 카드 안, 진행 바 위치, 모바일 dock 범위를 관리자에서 비교합니다."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={isHomePreviewStrongMode ? "/admin/design-lab?mode=home-preview" : "/admin/design-lab?mode=home-preview-strong"}
                className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
              >
                {isHomePreviewStrongMode ? "전체 비교 보기" : "강한 카드안만 보기"}
              </Link>
              <Link
                href="/admin/design-lab?mode=native"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Figma Native 보기
              </Link>
              <Link
                href="/admin/design-lab"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Legacy 보기
              </Link>
            </div>
          </div>
        </section>

        <HomeDesignPreview focus={isHomePreviewStrongMode ? "strong" : "all"} />
      </main>
    );
  }

  if (isNativeMode) {
    return (
      <main className="container mx-auto px-4 py-4">
        <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                Design Lab Native Preview
              </p>
              <p className="text-sm text-slate-600">
                Figma node <span className="font-semibold text-slate-900">0:495</span> 기준 프로필 화면을 네이티브로 포팅했습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/design-lab"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Legacy 보기
              </Link>
            </div>
          </div>
        </section>

        <DesignLabProfilePreview />
      </main>
    );
  }

  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ["admin/design-lab/"] });
  const iframeSrc = safePath && legacyPublicFileExists(safePath)
    ? `/${safePath}`
    : "/admin/design-lab/index.html";

  return (
    <main className="route-embed-page container mx-auto px-4 py-4">
      <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              Design Lab Legacy Bridge
            </p>
            <p className="text-sm text-slate-600">
              기존 Design Lab HTML을 경로 가드와 함께 브릿지합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/design-lab?mode=native"
              className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
            >
              Figma Native 보기
            </Link>
          </div>
        </div>
      </section>

      <div className="route-embed-page-body">
        <RouteEmbedFrame
          src={iframeSrc}
          title="100x Admin Design Lab"
          loading="eager"
          shellClassName="route-embed-shell-fill-parent"
        />
      </div>
    </main>
  );
}
