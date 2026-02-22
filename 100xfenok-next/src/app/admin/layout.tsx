import type { ReactNode } from "react";
import AdminAccessGate from "@/components/AdminAccessGate";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminAccessGate>{children}</AdminAccessGate>;
}
