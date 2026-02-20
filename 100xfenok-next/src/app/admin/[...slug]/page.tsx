import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Admin Legacy Bridge",
  description: "Legacy admin 페이지를 Next.js 라우트로 브릿지합니다.",
};

interface AdminLegacyPageProps {
  params: Promise<{ slug: string[] }>;
}

function isSafeSlug(slug: string[]): boolean {
  return slug.every(
    (segment) =>
      !!segment &&
      !segment.includes("/") &&
      !segment.includes("\\") &&
      !segment.includes("..") &&
      !segment.startsWith("."),
  );
}

function resolveLegacyIframeSrc(slug: string[]): string | null {
  const joined = slug.join("/");

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

  if (!slug || slug.length === 0 || !isSafeSlug(slug)) {
    notFound();
  }

  const iframeSrc = resolveLegacyIframeSrc(slug);
  if (!iframeSrc) {
    notFound();
  }

  return (
    <div className="route-embed-shell">
      <iframe
        src={iframeSrc}
        title={`100x Admin ${slug.join(" / ")}`}
        className="h-full w-full border-0"
      />
    </div>
  );
}
