import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { ROUTES } from "@/lib/routes";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";
import { canonicalPath } from "@/lib/site-url";
import { isSafeSlugSegments } from "@/lib/server/legacy-bridge";
import { readPostMetadataBySlug, readPostStaticParams } from "@/lib/server/posts";

const defaultMetadata: Metadata = {
  title: "분석 아카이브 상세",
  description: "분석 리포트 상세 페이지입니다.",
};

const POSTS_DETAIL_BOUNDARY_CHIPS = [
  { key: "archive", label: "아카이브" },
  { key: "legacy-html", label: "레거시 HTML" },
  { key: "research", label: "심층 리서치" },
] as const;

const POSTS_DETAIL_OWNER_LINKS = [
  { key: "archive", label: "전체 아카이브", href: ROUTES.posts },
  { key: "alpha-scout", label: "Alpha Scout", href: ROUTES.alphaScout },
  { key: "daily-wrap", label: "Daily Wrap", href: ROUTES.dailyWrap },
] as const;

interface PostLegacyPageProps {
  params: Promise<{ slug: string[] }>;
}

export function generateStaticParams(): Array<{ slug: string[] }> {
  return readPostStaticParams();
}

export async function generateMetadata({
  params,
}: PostLegacyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await readPostMetadataBySlug(slug);

  if (!post) {
    return defaultMetadata;
  }

  return {
    title: post.title,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
    },
    alternates: {
      canonical: canonicalPath(`/posts/${slug.join("/")}`),
    },
  };
}

export default async function PostLegacyPage({ params }: PostLegacyPageProps) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    {},
    cookieStore.get("fenok_design_version")?.value,
  );

  if (!slug || slug.length === 0 || !isSafeSlugSegments(slug)) {
    notFound();
  }

  const post = await readPostMetadataBySlug(slug);
  if (!post) {
    notFound();
  }

  const frame = (
    <RouteEmbedFrame
      src={post.publicPath}
      title={post.title}
      loading="eager"
      shellClassName={version === "v1" ? undefined : "route-embed-shell-app"}
    />
  );

  if (version === "v1") return frame;

  return (
    <div className="fnk-shell">
      <AppShell active="posts" title={post.title} backHref={ROUTES.home}>
        <div
          data-posts-detail-surface
          data-posts-detail-route-owner="legacy-post-html"
          className="min-h-screen px-3 py-4 sm:px-4 md:px-6"
          style={{ backgroundColor: "var(--c-surface-2)" }}
        >
          <section
            data-posts-detail-boundary
            className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Route owner</p>
            <h1 className="mt-2 text-xl font-black text-slate-900">레거시 리포트</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              기존 HTML 리포트를 분석 아카이브 안에서 읽는 상세 화면입니다. 네이티브 화면 전환 전까지
              출처와 이동 경계를 분리합니다.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {POSTS_DETAIL_BOUNDARY_CHIPS.map((chip) => (
                <span
                  key={chip.key}
                  data-posts-detail-boundary-chip={chip.key}
                  className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700"
                >
                  {chip.label}
                </span>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {POSTS_DETAIL_OWNER_LINKS.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  data-posts-detail-owner-link={link.key}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </section>
          <div data-posts-detail-legacy-frame>
            {frame}
          </div>
        </div>
      </AppShell>
    </div>
  );
}
