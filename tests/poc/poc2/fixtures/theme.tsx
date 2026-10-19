"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

// どちらのグラフで実行されたかを記録する（Server Graph の React には useState がない）
((globalThis as any).__proofyardLog ??= []).push(`theme.tsx executed: useState=${typeof useState}`);

const Theme = createContext("light");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState("dark");
  return <Theme.Provider value={theme}>{children}</Theme.Provider>;
}

export function Card({ user }: { user: { name: string }; format?: (name: string) => string }) {
  return <p>{user.name} ({useContext(Theme)})</p>;
}
