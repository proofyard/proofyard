"use client";

import { useState } from "react";
import { tlaValue } from "./tla-value";

export function TlaClient() {
  const [count, setCount] = useState(0);
  return (
    <section>
      <h1>{tlaValue}</h1>
      <button onClick={() => setCount(count + 1)}>Clicked {count}</button>
    </section>
  );
}
