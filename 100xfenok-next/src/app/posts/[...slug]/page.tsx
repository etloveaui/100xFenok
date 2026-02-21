import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";

export const metadata: Metadata = {
  title: "분석 아카이브 상세",
  description: "기존 posts 상세 HTML을 Next.js 라우트로 브릿지합니다.",
};

interface PostLegacyPageProps {
  params: Promise<{ slug: string[] }>;
}

const POSTS_ROOT = path.join(process.cwd(), "public", "posts");

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

function normalizePublicPath(absolutePath: string): string | null {
  const relative = path.relative(POSTS_ROOT, absolutePath);
  if (!relative || relative.startsWith("..")) {
    return null;
  }
  return `/posts/${relative.replaceAll(path.sep, "/")}`;
}

function resolveLegacyPostSrc(slug: string[]): string | null {
  const joined = slug.join("/");
  const candidates = joined.endsWith(".html")
    ? [joined]
    : [`${joined}.html`, path.join(joined, "index.html")];

  for (const candidate of candidates) {
    const absolutePath = path.resolve(POSTS_ROOT, candidate);
    if (!absolutePath.startsWith(`${POSTS_ROOT}${path.sep}`)) continue;
    if (!fs.existsSync(absolutePath)) continue;
    if (!fs.statSync(absolutePath).isFile()) continue;

    const publicPath = normalizePublicPath(absolutePath);
    if (publicPath) return publicPath;
  }

  return null;
}

function collectPostSlugs(): string[][] {
  if (!fs.existsSync(POSTS_ROOT)) return [];

  const slugs: string[][] = [];
  const stack = [POSTS_ROOT];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".html")) {
        continue;
      }

      const relative = path.relative(POSTS_ROOT, absolutePath);
      if (relative.startsWith("..")) continue;

      const slug = relative
        .replaceAll(path.sep, "/")
        .split("/")
        .filter(Boolean);

      if (slug.length > 0) {
        slugs.push(slug);
      }
    }
  }

  return slugs;
}

export function generateStaticParams(): Array<{ slug: string[] }> {
  return collectPostSlugs().map((slug) => ({ slug }));
}

export default async function PostLegacyPage({ params }: PostLegacyPageProps) {
  const { slug } = await params;

  if (!slug || slug.length === 0 || !isSafeSlug(slug)) {
    notFound();
  }

  const iframeSrc = resolveLegacyPostSrc(slug);
  if (!iframeSrc) {
    notFound();
  }

  return <RouteEmbedFrame src={iframeSrc} title={`Posts Detail ${slug.join(" / ")}`} loading="eager" />;
}
