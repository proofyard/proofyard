"use client";
import "client-only";
import { useSyncExternalStore } from "react";

// React の外のストア（useSyncExternalStore）。サーバーでは getServerSnapshot の値
let clicks = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function ExternalStore() {
  const value = useSyncExternalStore(subscribe, () => `clicks ${clicks}`, () => "server");
  return (
    <button
      onClick={() => {
        clicks += 1;
        listeners.forEach((listener) => listener());
      }}
    >
      {value}
    </button>
  );
}
