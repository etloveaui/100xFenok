import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Data Lab",
  description: "100xFenok 데이터 관리 실험실",
};

export default function AdminDataLabPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/admin/data-lab/index.html"
        title="100x Admin Data Lab"
        className="h-full w-full border-0"
      />
    </div>
  );
}
