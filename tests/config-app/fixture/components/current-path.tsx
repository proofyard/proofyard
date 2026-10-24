"use client";
// usePathname は basePath を除いたパス
import { usePathname } from "next/navigation";

export function CurrentPath() {
  return <p>Path {usePathname()}</p>;
}
