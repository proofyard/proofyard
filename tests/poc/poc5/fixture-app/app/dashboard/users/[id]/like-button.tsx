"use client";
import { usePathname } from "next/navigation";
import { useState } from "react";

export const LikeButton = ({ initial }: { initial: number }) => {
  const [likes, setLikes] = useState(initial);
  return (
    <button type="button" onClick={() => setLikes(likes + 1)}>
      likes: {likes} at {usePathname()}
    </button>
  );
};
