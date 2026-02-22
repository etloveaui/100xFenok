import type { ReactNode } from "react";
import AdminAccessGate from "@/components/AdminAccessGate";
import AdminSessionControl from "@/components/AdminSessionControl";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAccessGate>
      <AdminSessionControl />
      {children}
    </AdminAccessGate>
  );
}
