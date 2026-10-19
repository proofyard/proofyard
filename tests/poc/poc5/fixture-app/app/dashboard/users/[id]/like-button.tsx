"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";

export function LikeButton({ initial }: { initial: number }) {
  const [likes] = useState(initial);
  return <button type="button">likes: {likes} at {usePathname()}</button>;
}
