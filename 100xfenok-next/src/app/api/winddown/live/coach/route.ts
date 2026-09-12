import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/server/admin-session";
import { executeWindDownCoachRequest, isWindDownGroqCoachEnabled } from "@/features/winddown/server/voiceCoach";
import { buildWindDownCoachContext } from "@/features/winddown/voice/coachContract";
import { readMonaVnextLearningProfileThroughCoordinator } from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import { loadWindDownStudyMaterial } from "@/features/winddown/server/publishedMaterialAdapter";

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function POST(request: Request) {
  return executeWindDownCoachRequest(request, {
    authenticated: async () => verifyAdminSessionToken((await cookies()).get(ADMIN_SESSION_COOKIE)?.value ?? null),
    context: async () => {
      if (!isWindDownGroqCoachEnabled()) throw new Error("COACH_UNAVAILABLE");
      // Optional context must never prevent the learner from having a conversation.
      try {
        const [profile, material] = await Promise.all([
          readMonaVnextLearningProfileThroughCoordinator({ initialize: false }),
          loadWindDownStudyMaterial({ dueExpressionIds: [], deferredExpressionIds: [] }),
        ]);
        return buildWindDownCoachContext(profile, material.entries);
      } catch { return { recentPractice: [] }; }
    },
  });
}
