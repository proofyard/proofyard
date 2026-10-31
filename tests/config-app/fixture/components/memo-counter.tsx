"use client";

import { useState } from "react";

// React Compiler（next.config.ts の reactCompiler）がメモ化すると、親の state が変わっても Child は描画し直されない
const Child = () => {
  const g = globalThis as { childRenders?: number };
  // oxlint-disable-next-line react/immutability -- テストで描画回数を数えるため、意図的に globalThis を書き換える
  g.childRenders = (g.childRenders ?? 0) + 1;
  return <p>Child</p>;
};

export const MemoCounter = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setCount(count + 1)}>
        Count {count}
      </button>
      <Child />
    </div>
  );
};
