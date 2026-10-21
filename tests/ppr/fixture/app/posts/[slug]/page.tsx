import { Suspense } from "react";
import { connection } from "next/server";

export async function generateStaticParams() {
  return [{ slug: "hello" }];
}

async function Views() {
  await connection();
  return <p>Views: 7</p>;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main>
      <h1>Post {slug}</h1>
      <Suspense fallback={<p>Loading views</p>}>
        <Views />
      </Suspense>
    </main>
  );
}
