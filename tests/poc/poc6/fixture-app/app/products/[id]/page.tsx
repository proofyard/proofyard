import { cacheLife, cacheTag } from "next/cache";
import { Suspense } from "react";

// "use cache" の関数が実際に実行された回数（キャッシュに当たれば増えない）
let calls = 0;

// oxlint-disable-next-line func-style, require-await -- "use cache" の関数（Next.js のコンパイラが変換する。async が要る）
async function getProduct(id: string) {
  "use cache";
  cacheTag(`product-${id}`);
  // revalidate は、負荷の高いマシンで 1 つのテストが過ぎない長さ（過ぎると裏で再実行され、回数がずれる）
  cacheLife({ expire: 60, revalidate: 3, stale: 0 });
  calls += 1;
  return { call: calls, id };
}

const Product = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const product = await getProduct(id);
  return (
    <p>
      product {product.id} call {product.call}
    </p>
  );
};

const Page = ({ params }: { params: Promise<{ id: string }> }) => (
  <Suspense fallback={<p>loading</p>}>
    <Product params={params} />
  </Suspense>
);

export default Page;
