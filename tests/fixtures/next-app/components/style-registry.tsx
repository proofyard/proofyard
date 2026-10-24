"use client";
// useServerInsertedHTML: CSS-in-JS のライブラリと同じく、SSR の HTML に <style> を差し込む
// （コールバックは HTML を書き出すたびに呼ばれるので、ライブラリと同じく一度だけ出す）
import { useServerInsertedHTML } from "next/navigation";
import { useRef } from "react";

export function StyleRegistry({ children }: { children: React.ReactNode }) {
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <style id="inserted-style">{".inserted { color: rebeccapurple; }"}</style>;
  });
  return <>{children}</>;
}
