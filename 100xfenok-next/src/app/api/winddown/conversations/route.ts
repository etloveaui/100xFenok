import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/server/admin-session";
import { readWindDownConversationsThroughCoordinator } from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import { executeWindDownConversationHistoryRequest } from "@/features/winddown/server/conversationHistory";

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET(request: Request) {
  return executeWindDownConversationHistoryRequest(request, {
    authenticated: async () => {
      const store = await cookies();
      return verifyAdminSessionToken(store.get(ADMIN_SESSION_COOKIE)?.value);
    },
    read: readWindDownConversationsThroughCoordinator,
  });
}
