import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { Todos } from "../../components/query";
import { todos } from "../../components/todos";

// Server Component で prefetch し、HydrationBoundary でクライアントのキャッシュに渡す（TanStack Query の App Router の使い方）
export default async function QueryPage() {
  const client = new QueryClient();
  await client.prefetchQuery({
    queryKey: ["todos"],
    queryFn: async () => {
      todos.serverFetches += 1;
      return [...todos.items];
    },
  });
  return (
    <main>
      <h1>Query</h1>
      <HydrationBoundary state={dehydrate(client)}>
        <Todos />
      </HydrationBoundary>
    </main>
  );
}
