import type { ReactNode } from "react";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/AdminAccessGate";
import AdminSessionControl from "@/components/AdminSessionControl";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const authenticated = await verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );

  if (!authenticated) {
    return <AdminAccessGate />;
  }

  return (
    <>
      <AdminSessionControl />
      {children}
    </>
  );
}
