import { POST_HTML_FILES } from "@/generated/static-route-manifest";
import { resolvePostCandidates } from "@/lib/post-candidates";
import { readPublicAssetText } from "@/lib/server/public-assets";

export type PostCatalogEntry = {
  slug: string[];
  href: string;
  title: string;
  description: string;
  publishedAt: string;
  displayDate: string;
  badgeLabel: string;
  badgeClass: string;
};

const POST_PUBLIC_ROOT = "/posts-raw";
const POST_HTML_FILE_SET = new Set<string>(POST_HTML_FILES);

function extractFirst(pattern: RegExp, source: string): string | null {
  const match = source.match(pattern);
  return match?.[1]?.trim() || null;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeText(value: string | null | undefined, fallback = ""): string {
  if (!value) return fallback;
  return stripTags(decodeHtml(value));
}

function parseDateFromPath(relativePath: string): string {
  const match = relativePath.match(/(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "1970-01-01";
}

function extractParagraphSummary(html: string): string | null {
  const matches = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const match of matches) {
    const text = normalizeText(match[1]);
    if (text.length >= 60) {
      return text;
    }
  }
  return null;
}

function getBadgeMeta(title: string, relativePath: string) {
  const haystack = `${title} ${relativePath}`.toLowerCase();

  if (haystack.includes("alpha pick")) {
    return { badgeLabel: "Alpha Pick", badgeClass: "posts-badge-alphapick" };
  }
  if (haystack.includes("masterplan") || haystack.includes("마스터플랜")) {
    return { badgeLabel: "마스터플랜", badgeClass: "posts-badge-masterplan" };
  }
  if (haystack.includes("playbook") || haystack.includes("플레이북")) {
    return { badgeLabel: "플레이북", badgeClass: "posts-badge-playbook" };
  }
  if (haystack.includes("종합 분석") || haystack.includes("tariff") || haystack.includes("ieepa")) {
    return { badgeLabel: "주요 분석", badgeClass: "posts-badge-alphapick" };
  }

  return { badgeLabel: "리포트", badgeClass: "posts-badge-alphapick" };
}

function collectHtmlFiles(): string[] {
  return [...POST_HTML_FILES].sort((left, right) => right.localeCompare(left));
}

export function readPostStaticParams(): Array<{ slug: string[] }> {
  return collectHtmlFiles().map((relativePath) => ({
    slug: relativePath.split("/").filter(Boolean),
  }));
}

export async function readPostCatalog(): Promise<PostCatalogEntry[]> {
  const files = collectHtmlFiles();

  const entries = await Promise.all(
    files.map(async (relativePath) => {
      const html = await readPublicAssetText(`${POST_PUBLIC_ROOT}/${relativePath}`);

      const title = normalizeText(
        extractFirst(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i, html)
          || extractFirst(/<title>([^<]+)<\/title>/i, html),
        relativePath.replace(/\.html$/, ""),
      );
      const description = normalizeText(
        extractFirst(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i, html)
          || extractParagraphSummary(html),
        "리포트 상세 페이지입니다.",
      );
      const publishedAt = parseDateFromPath(relativePath);
      const slug = relativePath.split("/").filter(Boolean);
      const { badgeLabel, badgeClass } = getBadgeMeta(title, relativePath);

      return {
        slug,
        href: `/posts/${slug.join("/")}`,
        title,
        description,
        publishedAt,
        displayDate: publishedAt,
        badgeLabel,
        badgeClass,
      } satisfies PostCatalogEntry;
    }),
  );

  return entries.sort((left, right) => {
    if (left.publishedAt !== right.publishedAt) {
      return right.publishedAt.localeCompare(left.publishedAt);
    }
    return left.title.localeCompare(right.title, "ko");
  });
}

export function resolvePostPublicPathBySlug(slug: string[]): string | null {
  for (const candidate of resolvePostCandidates(slug)) {
    if (POST_HTML_FILE_SET.has(candidate)) {
      return `${POST_PUBLIC_ROOT}/${candidate}`;
    }
  }

  return null;
}

export async function readPostMetadataBySlug(slug: string[]) {
  const publicPath = resolvePostPublicPathBySlug(slug);
  if (!publicPath) return null;

  const html = await readPublicAssetText(publicPath);
  const title = normalizeText(
    extractFirst(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i, html)
      || extractFirst(/<title>([^<]+)<\/title>/i, html),
    slug.join(" / "),
  );
  const description = normalizeText(
    extractFirst(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i, html)
      || extractParagraphSummary(html),
    "분석 리포트 상세 페이지입니다.",
  );

  return {
    title,
    description,
    publicPath,
  };
}
