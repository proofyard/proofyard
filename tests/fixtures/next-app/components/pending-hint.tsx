"use client";
// useLinkStatus: 親の <Link> のナビゲーションの途中か
import { useLinkStatus } from "next/link";

export const PendingHint = () => {
  const { pending } = useLinkStatus();
  return <span>{pending ? "(loading)" : "(idle)"}</span>;
};
