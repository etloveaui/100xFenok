import HomeV1Client from "./HomeV1Client";
import HomeV2Client from "./HomeV2Client";
import HomeV3Client from "./HomeV3Client";
import HomeV4Client from "./HomeV4Client";
import WorkbenchView from "@/components/workbench/WorkbenchView";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";
import { cookies } from "next/headers";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Home route. Server component shell that preserves legacy design backdoors.
 * V5 is the product workbench; the briefing board lives at /briefing.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );
  if (version === "v5") return <WorkbenchView />;
  if (version === "v4") return <HomeV4Client />;
  if (version === "v3") return <HomeV3Client />;
  if (version === "v2") return <HomeV2Client />;
  return <HomeV1Client />;
}
