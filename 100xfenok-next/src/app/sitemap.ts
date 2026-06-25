import type { MetadataRoute } from "next";
import { SITEMAP_PRODUCT_ROUTES } from "@/lib/routes";
import { canonicalUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_PRODUCT_ROUTES.map((route) => ({
    url: canonicalUrl(route.path),
    lastModified: new Date(),
    changeFrequency: route.changeFrequency as MetadataRoute.Sitemap[number]["changeFrequency"],
    priority: route.priority,
  }));
}
