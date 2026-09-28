import type { Metadata } from "next";
import AdminUsersClient from "./AdminUsersClient";

export const dynamic = "force-dynamic";
export const revalidate = false;

export const metadata: Metadata = {
  title: "사용자 관리 | 100xFenok Admin",
  description: "실시간 접속자 모니터링, 로그인 통계, 계정 차단 및 세션 관리",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function AdminUsersPage() {
  return <AdminUsersClient />;
}
