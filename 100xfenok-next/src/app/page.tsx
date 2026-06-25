import HomeV1Client from "./HomeV1Client";
import HomeV2Client from "./HomeV2Client";
import HomeV3Client from "./HomeV3Client";
import HomeV4Client from "./HomeV4Client";
import HomeV5Client from "./HomeV5Client";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Home route. Server component shell that branches on gated design versions.
 * V5 is isolated behind `?v5=1` / env override and does not change the
 * existing fallback branch.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const version = getDesignVersionFromSearchParams(params);
  if (version === "v5") return <HomeV5Client />;
  if (version === "v4") return <HomeV4Client />;
  if (version === "v3") return <HomeV3Client />;
  if (version === "v2") return <HomeV2Client />;
  return <HomeV1Client />;
}
