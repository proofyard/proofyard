"use client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

export const QueryProvider = ({ children }: { children: React.ReactNode }) => {
  // TanStack Query の App Router の例と同じく、ブラウザではレンダーごとに作り直さない
  // oxlint-disable-next-line react/hook-use-state -- setter は使わない（TanStack Query の例と同じく一度だけ作る）
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

export const Todos = () => {
  const client = useQueryClient();
  const { data } = useQuery({
    queryFn: () =>
      fetch("/api/todos").then((r) => r.json() as Promise<string[]>),
    queryKey: ["todos"],
  });
  const add = useMutation({
    mutationFn: (title: string) =>
      fetch("/api/todos", { body: title, method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["todos"] }),
  });
  return (
    <>
      <ul aria-label="todos">
        {data?.map((todo) => (
          <li key={todo}>{todo}</li>
        ))}
      </ul>
      <button type="button" onClick={() => add.mutate("Ship it")}>
        Add todo
      </button>
    </>
  );
};
