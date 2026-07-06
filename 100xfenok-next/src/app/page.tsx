import HomeCanvasPlusClient from "./HomeCanvasPlusClient";

/**
 * Home route. Server component shell that renders the CANVAS+ home (v6).
 * Legacy v1-v5 branches were removed in legacy removal L1.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  return <HomeCanvasPlusClient />;
}
