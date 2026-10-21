import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";

// "use cache" の関数が実際に実行された回数（キャッシュに当たれば増えない）
let calls = 0;

async function getProduct(id: string) {
  "use cache";
  cacheTag(`product-${id}`);
  // revalidate は、負荷の高いマシンで 1 つのテストが過ぎない長さ（過ぎると裏で再実行され、回数がずれる）
  cacheLife({ stale: 0, revalidate: 3, expire: 60 });
  calls += 1;
  return { id, call: calls };
}

async function Product({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  return (
    <p>
      product {product.id} call {product.call}
    </p>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>loading</p>}>
      <Product params={params} />
    </Suspense>
  );
}
