import HomeV1Client from "./HomeV1Client";
import HomeV2Client from "./HomeV2Client";
import HomeV3Client from "./HomeV3Client";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Home route. Server component shell that branches on `?v2=1` / `?v3=1`
 * between V1 (production default, unchanged), V2 (Claude Design audit
 * fixes, DEC-197), and V3 (Claude Design Watch & Alert, DEC-199).
 */
export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const version = getDesignVersionFromSearchParams(params);
  if (version === "v3") return <HomeV3Client />;
  if (version === "v2") return <HomeV2Client />;
  return <HomeV1Client />;
}
