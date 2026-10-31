// generateSitemaps: 1 つのファイルから複数のサイトマップ（/catalog/sitemap/0.xml など）
import type { MetadataRoute } from "next";

// oxlint-disable-next-line eslint/require-await -- Next.js の generateSitemaps と同じく async にする
export const generateSitemaps = async () => [{ id: 0 }, { id: 1 }];

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = await props.id;
  return [
    {
      lastModified: new Date("2026-01-01"),
      url: `https://example.com/catalog/${id}/item`,
    },
  ];
}
