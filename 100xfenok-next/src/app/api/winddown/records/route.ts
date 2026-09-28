import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/server/admin-session";
import {
  exportWindDownRecordsThroughCoordinator,
  verifyWindDownRecoveryCopyThroughCoordinator,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import { executeWindDownRecoveryRequest } from "@/features/winddown/server/recoveryApi";

export const dynamic = "force-dynamic";
export const revalidate = false;

async function handle(request: Request) {
  return executeWindDownRecoveryRequest(request, {
    authenticated: async () => {
      const store = await cookies();
      return verifyAdminSessionToken(store.get(ADMIN_SESSION_COOKIE)?.value);
    },
    exportSnapshot: exportWindDownRecordsThroughCoordinator,
    restoreCopy: verifyWindDownRecoveryCopyThroughCoordinator,
  });
}

export { handle as GET, handle as POST };
