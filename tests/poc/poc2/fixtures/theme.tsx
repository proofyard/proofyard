"use client";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

// どちらのグラフで実行されたかを記録する（Server Graph の React には useState がない）
const g = globalThis as typeof globalThis & { __proofyardLog?: string[] };
g.__proofyardLog ??= [];
g.__proofyardLog.push(`theme.tsx executed: useState=${typeof useState}`);

const Theme = createContext("light");

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // oxlint-disable-next-line react/hook-use-state -- 値だけを使う（setter は要らない）
  const [theme] = useState("dark");
  return <Theme.Provider value={theme}>{children}</Theme.Provider>;
};

export const Card = ({
  user,
}: {
  user: { name: string };
  format?: (name: string) => string;
}) => (
  <p>
    {user.name} ({useContext(Theme)})
  </p>
);
