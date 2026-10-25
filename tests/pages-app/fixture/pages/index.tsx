import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import { greeting } from "../lib/greeting";
import { useTheme } from "../lib/theme";

type Props = { message: string };

export const getServerSideProps: GetServerSideProps<Props> = async ({ req }) => ({
  props: { message: greeting(req.cookies.name) },
});

export default function Home({ message }: Props) {
  const [count, setCount] = useState(0);
  return (
    <main>
      <Head>
        <title>Pages home</title>
      </Head>
      <h1>{message}</h1>
      <p>theme: {useTheme()}</p>
      <button onClick={() => setCount(count + 1)}>count {count}</button>
      <Link href="/about">About</Link>
    </main>
  );
}
