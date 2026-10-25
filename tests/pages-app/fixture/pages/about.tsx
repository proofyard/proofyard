import type { GetStaticProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";

type Props = { built: string };

export const getStaticProps: GetStaticProps<Props> = async () => ({ props: { built: "at build time" } });

export default function About({ built }: Props) {
  const router = useRouter();
  return (
    <main>
      <h1>About</h1>
      <p>built {built}</p>
      <p>pathname {router.pathname}</p>
      <Link href="/posts/1">Post 1</Link>
      <button onClick={() => router.push("/posts/2?from=about")}>Go to post 2</button>
    </main>
  );
}
