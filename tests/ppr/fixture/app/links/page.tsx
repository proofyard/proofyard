import Link from "next/link";

// Link の先読みは next build の prefetch hints（server/prefetch-hints.json）で、静的なものを試すかが決まる
export default function Page() {
  return (
    <main>
      <h1>Links</h1>
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/posts/hello">Hello post</Link>
    </main>
  );
}
