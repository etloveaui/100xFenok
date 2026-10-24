import { permanentRedirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default function RetiredStockAnalyzerPage() {
  permanentRedirect(ROUTES.screener);
}
