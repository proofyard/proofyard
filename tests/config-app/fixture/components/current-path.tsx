"use client";
// usePathname は basePath を除いたパス
import { usePathname } from "next/navigation";

export const CurrentPath = () => <p>Path {usePathname()}</p>;
