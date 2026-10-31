"use client";
import { useRouter } from "next/navigation";

export const BackHome = () => {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.push("/dashboard")}>
      Go home
    </button>
  );
};
