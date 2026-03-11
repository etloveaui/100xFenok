import fs from "node:fs";
import path from "node:path";

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

const POSTS_ROOT = path.join(process.cwd(), "public", "posts-raw");

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

function collectHtmlFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];

  const files: string[] = [];
  const stack = [root];

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

      const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, "/");
      if (relativePath === "posts-main.html") {
        continue;
      }
      files.push(relativePath);
    }
  }

  return files.sort((left, right) => right.localeCompare(left));
}

export function readPostCatalog(): PostCatalogEntry[] {
  const files = collectHtmlFiles(POSTS_ROOT);

  return files
    .map((relativePath) => {
      const absolutePath = path.join(POSTS_ROOT, relativePath);
      const html = fs.readFileSync(absolutePath, "utf8");

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
    })
    .sort((left, right) => {
      if (left.publishedAt !== right.publishedAt) {
        return right.publishedAt.localeCompare(left.publishedAt);
      }
      return left.title.localeCompare(right.title, "ko");
    });
}

export function resolvePostFileBySlug(slug: string[]): string | null {
  const joined = slug.join("/");
  const candidates = joined.endsWith(".html")
    ? [joined]
    : [`${joined}.html`, path.join(joined, "index.html")];

  for (const candidate of candidates) {
    const absolutePath = path.resolve(POSTS_ROOT, candidate);
    if (!absolutePath.startsWith(`${POSTS_ROOT}${path.sep}`)) continue;
    if (!fs.existsSync(absolutePath)) continue;
    if (!fs.statSync(absolutePath).isFile()) continue;
    return absolutePath;
  }

  return null;
}

export function normalizePostPublicPath(absolutePath: string): string | null {
  const relative = path.relative(POSTS_ROOT, absolutePath);
  if (!relative || relative.startsWith("..")) {
    return null;
  }
  return `/posts-raw/${relative.replaceAll(path.sep, "/")}`;
}

export function readPostMetadataBySlug(slug: string[]) {
  const absolutePath = resolvePostFileBySlug(slug);
  if (!absolutePath) return null;

  const html = fs.readFileSync(absolutePath, "utf8");
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
  const publicPath = normalizePostPublicPath(absolutePath);

  return publicPath
    ? {
        title,
        description,
        publicPath,
      }
    : null;
}
