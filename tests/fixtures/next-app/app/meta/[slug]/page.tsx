import type { Metadata, Viewport } from "next";

export const generateViewport = (): Viewport => ({ themeColor: "#123456" });

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> => {
  const { slug } = await params;
  return { openGraph: { title: `OG ${slug}` }, title: `Post ${slug}` };
};

const Post = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  return <h1>Post {slug}</h1>;
};
export default Post;
