import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";

import { Todos } from "../../components/query";
import { todos } from "../../components/todos";

// Server Component で prefetch し、HydrationBoundary でクライアントのキャッシュに渡す（TanStack Query の App Router の使い方）
const QueryPage = async () => {
  const client = new QueryClient();
  await client.prefetchQuery({
    // oxlint-disable-next-line eslint/require-await -- queryFn は Promise を返す関数にする
    queryFn: async () => {
      // oxlint-disable-next-line react/immutability -- サーバーで取得した回数をテストで数えるため、意図的に書き換える
      todos.serverFetches += 1;
      return [...todos.items];
    },
    queryKey: ["todos"],
  });
  return (
    <main>
      <h1>Query</h1>
      <HydrationBoundary state={dehydrate(client)}>
        <Todos />
      </HydrationBoundary>
    </main>
  );
};
export default QueryPage;
