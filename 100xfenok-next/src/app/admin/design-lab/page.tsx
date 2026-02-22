import type { Metadata } from "next";
import Link from "next/link";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import DesignLabProfilePreview from "@/components/DesignLabProfilePreview";
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
    <main className="container mx-auto px-4 py-4">
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

      <RouteEmbedFrame src={iframeSrc} title="100x Admin Design Lab" loading="eager" />
    </main>
  );
}
