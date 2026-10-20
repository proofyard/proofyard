"use client";
import { useState } from "react";

export function LikeButton({ userId, initial }: { userId: number; initial: number }) {
  const [likes, setLikes] = useState(initial);
  return (
    <button type="button" data-user={userId} onClick={() => setLikes(likes + 1)}>
      likes: {likes}
    </button>
  );
}
