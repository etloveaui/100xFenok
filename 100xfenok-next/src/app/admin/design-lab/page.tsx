import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Design Lab",
  description: "100xFenok 디자인 실험실",
};

export default function AdminDesignLabPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/admin/design-lab/index.html"
        title="100x Admin Design Lab"
        className="h-full w-full border-0"
      />
    </div>
  );
}
