"use client";
import { useEffect, useState } from "react";

export const Counter = ({
  label,
  initial = 0,
}: {
  label: string;
  initial?: number;
}) => {
  const [count, setCount] = useState(initial);
  const [ready, setReady] = useState(false);
  // oxlint-disable-next-line react/set-state-in-effect -- ハイドレーション後に effect が動いたことを表示で確かめる
  useEffect(() => setReady(true), []);
  return (
    <div>
      <p>{ready ? "Ready" : "Not ready"}</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        {label}: {count}
      </button>
    </div>
  );
};
