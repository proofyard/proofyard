import { Suspense } from "react";

const Name = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return <p>Product {id}</p>;
};

const Page = ({ params }: { params: Promise<{ id: string }> }) => (
  <main>
    <h1>Product page</h1>
    <Suspense fallback={<p>Loading product</p>}>
      <Name params={params} />
    </Suspense>
  </main>
);
export default Page;
