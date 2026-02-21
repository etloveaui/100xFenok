import type { Metadata } from "next";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";

export const metadata: Metadata = {
  title: "Admin · Data Lab",
  description: "100xFenok 데이터 관리 실험실",
};

export default function AdminDataLabPage() {
  return <RouteEmbedFrame src="/admin/data-lab/index.html" title="100x Admin Data Lab" loading="eager" />;
}
