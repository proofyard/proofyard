import { connection } from "next/server";
import { Suspense } from "react";

// oxlint-disable-next-line eslint/require-await -- Next.js の generateStaticParams と同じく async にする
export const generateStaticParams = async () => [{ slug: "hello" }];

const Views = async () => {
  await connection();
  return <p>Views: 7</p>;
};

const Page = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  return (
    <main>
      <h1>Post {slug}</h1>
      <Suspense fallback={<p>Loading views</p>}>
        <Views />
      </Suspense>
    </main>
  );
};
export default Page;
