"use client";
import { useRouter } from "next/navigation";

export function BackHome() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.push("/dashboard")}>
      Go home
    </button>
  );
}
