"use client";
import { useDeferredValue, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const NAMES = ["Alice", "Bob", "Carol", "Dave"];

export function FilterList() {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <section>
      <input aria-label="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>{NAMES.filter((name) => name.toLowerCase().includes(deferred.toLowerCase())).map((name) => <li key={name}>{name}</li>)}</ul>
      <button onClick={() => startTransition(() => router.push("/slow"))}>Go slow</button>
      {pending && <p>Navigating</p>}
    </section>
  );
}
