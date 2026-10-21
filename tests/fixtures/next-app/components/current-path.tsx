"use client";
import { usePathname } from "next/navigation";

export function CurrentPath() {
  return <p>Path: {usePathname()}</p>;
}
