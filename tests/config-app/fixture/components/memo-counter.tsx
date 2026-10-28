"use client";

import { useState } from "react";

// React Compiler（next.config.ts の reactCompiler）がメモ化すると、親の state が変わっても Child は描画し直されない
function Child() {
  const g = globalThis as { childRenders?: number };
  g.childRenders = (g.childRenders ?? 0) + 1;
  return <p>Child</p>;
}

export function MemoCounter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>Count {count}</button>
      <Child />
    </div>
  );
}
