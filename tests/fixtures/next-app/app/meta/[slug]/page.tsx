import type { Metadata, Viewport } from "next";

export function generateViewport(): Viewport {
  return { themeColor: "#123456" };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Post ${slug}`, openGraph: { title: `OG ${slug}` } };
}

export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  return <h1>Post {(await params).slug}</h1>;
}
