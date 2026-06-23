import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/site-url";

const PUBLIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/explore", changeFrequency: "daily", priority: 0.9 },
  { path: "/market-valuation", changeFrequency: "daily", priority: 0.9 },
  { path: "/market-valuation/structure", changeFrequency: "daily", priority: 0.8 },
  { path: "/regime", changeFrequency: "daily", priority: 0.8 },
  { path: "/market/events", changeFrequency: "daily", priority: 0.8 },
  { path: "/sectors", changeFrequency: "daily", priority: 0.8 },
  { path: "/etfs", changeFrequency: "daily", priority: 0.9 },
  { path: "/etfs/compare", changeFrequency: "daily", priority: 0.75 },
  { path: "/etfs/new", changeFrequency: "daily", priority: 0.7 },
  { path: "/screener", changeFrequency: "daily", priority: 0.9 },
  { path: "/superinvestors", changeFrequency: "weekly", priority: 0.8 },
  { path: "/portfolio", changeFrequency: "weekly", priority: 0.7 },
  { path: "/posts", changeFrequency: "weekly", priority: 0.7 },
  { path: "/alpha-scout", changeFrequency: "weekly", priority: 0.7 },
  { path: "/ib", changeFrequency: "monthly", priority: 0.7 },
  { path: "/vr", changeFrequency: "monthly", priority: 0.6 },
  { path: "/radar", changeFrequency: "daily", priority: 0.7 },
  { path: "/100x/daily-wrap", changeFrequency: "daily", priority: 0.7 },
  { path: "/multichart", changeFrequency: "weekly", priority: 0.6 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: canonicalUrl(route.path),
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
