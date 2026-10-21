import { Suspense } from "react";

async function Name({ params }: { params: Promise<{ id: string }> }) {
  return <p>Product {(await params).id}</p>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main>
      <h1>Product page</h1>
      <Suspense fallback={<p>Loading product</p>}>
        <Name params={params} />
      </Suspense>
    </main>
  );
}
