import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { isSafeSlugSegments } from "@/lib/server/legacy-bridge";
import { publicAssetExists } from "@/lib/server/public-assets";

export const metadata: Metadata = {
  title: "Admin Legacy Bridge",
  description: "Legacy admin 페이지를 Next.js 라우트로 브릿지합니다.",
};

interface AdminLegacyPageProps {
  params: Promise<{ slug: string[] }>;
}

const legacyAliasBySlug: Record<string, string> = {
  "ib-helper": "ib/ib-helper/index.html",
};

async function resolveLegacyIframeSrc(slug: string[]): Promise<string | null> {
  const joined = slug.join("/");
  const alias = legacyAliasBySlug[joined];
  if (alias) {
    if (await publicAssetExists(alias)) {
      return `/${alias}`;
    }
  }

  const candidates = joined.endsWith(".html")
    ? [joined]
    : [`${joined}.html`, `${joined}/index.html`];

  for (const candidate of candidates) {
    const relativePath = `admin/${candidate}`.replaceAll("\\", "/");

    if (await publicAssetExists(relativePath)) {
      return `/${relativePath}`;
    }
  }

  return null;
}

export default async function AdminLegacyPage({ params }: AdminLegacyPageProps) {
  const { slug } = await params;

  if (!slug || slug.length === 0 || !isSafeSlugSegments(slug)) {
    notFound();
  }

  const iframeSrc = await resolveLegacyIframeSrc(slug);
  if (!iframeSrc) {
    notFound();
  }

  return <RouteEmbedFrame src={iframeSrc} title={`100x Admin ${slug.join(" / ")}`} loading="eager" />;
}
