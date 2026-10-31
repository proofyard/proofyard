"use client";
import { listEntries } from "fake-actions";
import { useState } from "react";

// Client Component から呼ぶサードパーティの Server Action（ブラウザのバンドルでは Server Reference になる）
export const EntryCount = () => {
  const [count, setCount] = useState<number>();
  return (
    <button
      type="button"
      onClick={async () => {
        const entries = await listEntries();
        setCount(entries.length);
      }}
    >
      {count === undefined ? "Count entries" : `entries: ${count}`}
    </button>
  );
};
