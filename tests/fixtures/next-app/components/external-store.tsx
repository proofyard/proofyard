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

export const ExternalStore = () => {
  const value = useSyncExternalStore(
    subscribe,
    () => `clicks ${clicks}`,
    () => "server"
  );
  return (
    // oxlint-disable-next-line react/button-has-type -- SSR の HTML（<button>server</button>）をテストが文字列で確かめる
    <button
      onClick={() => {
        clicks += 1;
        for (const listener of listeners) {
          listener();
        }
      }}
    >
      {value}
    </button>
  );
};
