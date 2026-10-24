import Link from "next/link";
import { CurrentPath } from "../components/current-path";

export default function Home() {
  return (
    <main>
      <h1>Config home</h1>
      <Link href="/about">About</Link>
      <CurrentPath />
    </main>
  );
}
