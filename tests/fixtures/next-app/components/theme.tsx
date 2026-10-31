"use client";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const ThemeContext = createContext<{
  theme: string;
  toggle: () => void;
} | null>(null);

export const ThemeProvider = ({
  initial,
  children,
}: {
  initial: string;
  children: ReactNode;
}) => {
  const [theme, setTheme] = useState(initial);
  return (
    <ThemeContext
      // oxlint-disable-next-line react/jsx-no-constructed-context-values -- テスト用の最小の Provider（メモ化しない）
      value={{
        theme,
        toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
      }}
    >
      {children}
    </ThemeContext>
  );
};

export const ThemeToggle = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("ThemeToggle must be used inside ThemeProvider");
  }
  const { theme, toggle } = context;
  return (
    <button type="button" onClick={toggle}>
      theme: {theme}
    </button>
  );
};
