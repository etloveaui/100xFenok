import type { Metadata } from "next";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";

export const metadata: Metadata = {
  title: "Admin · Design Lab",
  description: "100xFenok 디자인 실험실",
};

export default function AdminDesignLabPage() {
  return <RouteEmbedFrame src="/admin/design-lab/index.html" title="100x Admin Design Lab" loading="eager" />;
}
