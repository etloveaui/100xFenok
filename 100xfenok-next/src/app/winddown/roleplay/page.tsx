import type { Metadata } from "next";
import { getWindDownVoiceScenario } from "@/features/winddown/voice/product";
import { storyEpisodeById } from "@/features/winddown/game/model/story";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import WindDownVoiceClient from "@/features/winddown/voice/ui/WindDownVoiceClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "Roleplay · Wind-Down",
  description: "짧은 장면으로 말해보는 WIND DOWN 역할 대화",
  robots: { index: false, follow: false },
};

export default async function WindDownRoleplayPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cookieStore = await cookies();
  const authenticated = await verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );

  if (!authenticated) {
    return (
      <div data-immersive-route="winddown-roleplay">
        <AdminAccessGate />
      </div>
    );
  }

  const query = await searchParams;
  const scenario = getWindDownVoiceScenario(typeof query.scenario === "string" ? query.scenario : null);
  const episode = storyEpisodeById(typeof query.story === "string" ? query.story : "");
  const storyReturn = episode && scenario?.id === episode.scenarioId
    ? { id: episode.id, title: episode.title, location: episode.location, scenarioId: episode.scenarioId }
    : undefined;

  return (
    <div data-immersive-route="winddown-roleplay">
      <WindDownVoiceClient activity="roleplay" initialScenarioId={scenario?.id} storyReturn={storyReturn} />
    </div>
  );
}
