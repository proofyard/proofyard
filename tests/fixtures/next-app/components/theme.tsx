"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

const ThemeContext = createContext<{ theme: string; toggle(): void } | null>(null);

export function ThemeProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [theme, setTheme] = useState(initial);
  return <ThemeContext value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}>{children}</ThemeContext>;
}

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeToggle must be used inside ThemeProvider");
  return (
    <button type="button" onClick={context.toggle}>
      theme: {context.theme}
    </button>
  );
}
