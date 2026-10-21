"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";

export function LikeButton({ initial }: { initial: number }) {
  const [likes, setLikes] = useState(initial);
  return <button type="button" onClick={() => setLikes(likes + 1)}>likes: {likes} at {usePathname()}</button>;
}
