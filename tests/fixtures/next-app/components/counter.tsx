"use client";
import { useEffect, useState } from "react";

export function Counter({ label, initial = 0 }: { label: string; initial?: number }) {
  const [count, setCount] = useState(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div>
      <p>{ready ? "Ready" : "Not ready"}</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        {label}: {count}
      </button>
    </div>
  );
}
