import type { Metadata } from "next";
import { cookies } from "next/headers";
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
      <AppShell active="explore" title={post.title} backHref={ROUTES.explore}>
        {frame}
      </AppShell>
    </div>
  );
}
