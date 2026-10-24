// generateSitemaps: 1 つのファイルから複数のサイトマップ（/catalog/sitemap/0.xml など）
import type { MetadataRoute } from "next";

export async function generateSitemaps() {
  return [{ id: 0 }, { id: 1 }];
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = await props.id;
  return [{ url: `https://example.com/catalog/${id}/item`, lastModified: new Date("2026-01-01") }];
}
