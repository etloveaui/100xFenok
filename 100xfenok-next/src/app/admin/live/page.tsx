import type { Metadata } from "next";
import AdminLiveBench from "@/components/admin-live/AdminLiveBench";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "음성 대화 | FenoK",
  description: "Gemini 음성 대화",
};

export default function AdminLiveBenchPage() {
  return <AdminLiveBench />;
}
