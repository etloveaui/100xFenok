import type { Metadata } from "next";
import Link from "next/link";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import DesignLabProfilePreview from "@/components/DesignLabProfilePreview";
import HomeCandidatePreview, { type HomeCandidatePreviewMode } from "@/components/HomeCandidatePreview";
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
  const homeCandidateModeMap: Record<string, HomeCandidatePreviewMode> = {
    "home-preview": "overview",
    "home-preview-strong": "overview",
    "home-candidate-a": "candidate-a",
    "home-candidate-b": "candidate-b",
    "home-candidate-c": "candidate-c",
    "home-candidate-d": "candidate-d",
  };
  const homeCandidateMode = mode ? homeCandidateModeMap[mode] : undefined;

  if (homeCandidateMode) {
    return (
      <main className="container mx-auto px-4 py-4">
        <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                {homeCandidateMode === "overview" ? "Design Lab Home Candidate Lab" : "Design Lab Candidate Preview"}
              </p>
              <p className="text-sm text-slate-600">
                {homeCandidateMode === "overview"
                  ? "홈 전체 정보구조를 3~4개 다른 방식으로 비교하고, 사용자 선택 전용 후보를 점검합니다."
                  : "선택한 홈 후보를 특정 뷰포트로 보며 Hero와 30초 오버뷰 구조를 확인합니다."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/design-lab?mode=home-preview"
                className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
              >
                전체 후보 보기
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

        <HomeCandidatePreview initialMode={homeCandidateMode} />
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
