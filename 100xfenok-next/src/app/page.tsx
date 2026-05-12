import HomeV1Client from "./HomeV1Client";
import HomeV2Client from "./HomeV2Client";
import HomeV3Client from "./HomeV3Client";
import HomeV4Client from "./HomeV4Client";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Home route. Server component shell that branches on `?v2=1` / `?v3=1` /
 * `?v4=1` between V1 (production default), V2 (DEC-197), V3 (DEC-199),
 * and V4 polish (DEC-200).
 */
export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const version = getDesignVersionFromSearchParams(params);
  if (version === "v4") return <HomeV4Client />;
  if (version === "v3") return <HomeV3Client />;
  if (version === "v2") return <HomeV2Client />;
  return <HomeV1Client />;
}
