"use client";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // TanStack Query の App Router の例と同じく、ブラウザではレンダーごとに作り直さない
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function Todos() {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ["todos"], queryFn: () => fetch("/api/todos").then((r) => r.json() as Promise<string[]>) });
  const add = useMutation({
    mutationFn: (title: string) => fetch("/api/todos", { method: "POST", body: title }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["todos"] }),
  });
  return (
    <>
      <ul aria-label="todos">
        {data?.map((todo) => (
          <li key={todo}>{todo}</li>
        ))}
      </ul>
      <button onClick={() => add.mutate("Ship it")}>Add todo</button>
    </>
  );
}
