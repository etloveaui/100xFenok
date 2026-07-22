import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { resolveAdminLegacyCandidates } from "@/lib/admin-legacy-candidates";
import { isSafeSlugSegments } from "@/lib/server/legacy-bridge";
import { publicAssetExists } from "@/lib/server/public-assets";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Legacy Bridge",
  description: "Legacy admin 페이지를 Next.js 라우트로 브릿지합니다.",
};

interface AdminLegacyPageProps {
  params: Promise<{ slug: string[] }>;
}

// Candidate ORDER is owned by @/lib/admin-legacy-candidates so that this page
// and the edge middleware cannot drift. Only the existence probe differs: the
// page asks the filesystem/ASSETS binding, middleware asks the build-time
// manifest.
async function resolveLegacyIframeSrc(slug: string[]): Promise<string | null> {
  for (const relativePath of resolveAdminLegacyCandidates(slug)) {
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
