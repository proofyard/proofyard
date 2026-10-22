"use client";
import { useState } from "react";
import { listEntries } from "fake-actions";

// Client Component から呼ぶサードパーティの Server Action（ブラウザのバンドルでは Server Reference になる）
export function EntryCount() {
  const [count, setCount] = useState<number>();
  return <button onClick={async () => setCount((await listEntries()).length)}>{count === undefined ? "Count entries" : `entries: ${count}`}</button>;
}
