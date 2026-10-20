"use client";
import { use } from "react";

// Server Component から渡された Promise を Client Component で待つ
export function UserNames({ users }: { users: Promise<{ id: number; name: string }[]> }) {
  return (
    <ul>
      {use(users).map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
