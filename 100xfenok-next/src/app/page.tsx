import HomeV1Client from "./HomeV1Client";
import HomeV2Client from "./HomeV2Client";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Home route. Server component shell that branches on `?v2=1` between
 * the V1 dashboard (production, unchanged) and the V2 dashboard
 * (Claude Design handoff, gated rollout).
 *
 * Decision: DEC-197 · Plan: docs/planning/276-design-v2-master.md
 */
export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const version = getDesignVersionFromSearchParams(params);
  return version === "v2" ? <HomeV2Client /> : <HomeV1Client />;
}
