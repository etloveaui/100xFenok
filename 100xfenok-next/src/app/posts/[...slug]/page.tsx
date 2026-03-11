import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { isSafeSlugSegments } from "@/lib/server/legacy-bridge";
import { readPostCatalog, readPostMetadataBySlug } from "@/lib/server/posts";

const defaultMetadata: Metadata = {
  title: "분석 아카이브 상세",
  description: "분석 리포트 상세 페이지입니다.",
};

interface PostLegacyPageProps {
  params: Promise<{ slug: string[] }>;
}

export function generateStaticParams(): Array<{ slug: string[] }> {
  return readPostCatalog().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: PostLegacyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = readPostMetadataBySlug(slug);

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
  };
}

export default async function PostLegacyPage({ params }: PostLegacyPageProps) {
  const { slug } = await params;

  if (!slug || slug.length === 0 || !isSafeSlugSegments(slug)) {
    notFound();
  }

  const post = readPostMetadataBySlug(slug);
  if (!post) {
    notFound();
  }

  return <RouteEmbedFrame src={post.publicPath} title={post.title} loading="eager" />;
}
