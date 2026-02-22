import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { isSafeSlugSegments } from "@/lib/server/legacy-bridge";

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

function resolveLegacyIframeSrc(slug: string[]): string | null {
  const joined = slug.join("/");
  const alias = legacyAliasBySlug[joined];
  if (alias) {
    const aliasAbsPath = path.join(process.cwd(), "public", alias);
    if (fs.existsSync(aliasAbsPath) && fs.statSync(aliasAbsPath).isFile()) {
      return `/${alias.replaceAll(path.sep, "/")}`;
    }
  }

  const candidates = joined.endsWith(".html")
    ? [joined]
    : [`${joined}.html`, `${joined}/index.html`];

  for (const candidate of candidates) {
    const relativePath = path.join("admin", candidate);
    const absolutePath = path.join(process.cwd(), "public", relativePath);

    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return `/${relativePath.replaceAll(path.sep, "/")}`;
    }
  }

  return null;
}

export default async function AdminLegacyPage({ params }: AdminLegacyPageProps) {
  const { slug } = await params;

  if (!slug || slug.length === 0 || !isSafeSlugSegments(slug)) {
    notFound();
  }

  const iframeSrc = resolveLegacyIframeSrc(slug);
  if (!iframeSrc) {
    notFound();
  }

  return <RouteEmbedFrame src={iframeSrc} title={`100x Admin ${slug.join(" / ")}`} loading="eager" />;
}
