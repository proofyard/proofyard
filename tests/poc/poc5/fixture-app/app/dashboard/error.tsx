"use client";

export default function DashboardError({ error }: { error: Error }) {
  return <p role="alert">dashboard error: {error.message}</p>;
}
