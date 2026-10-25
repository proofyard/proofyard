import type { GetStaticPaths, GetStaticProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";

type Props = { id: string };

export const getStaticPaths: GetStaticPaths = async () => ({ paths: [{ params: { id: "1" } }], fallback: "blocking" });

export const getStaticProps: GetStaticProps<Props, { id: string }> = async ({ params }) => {
  if (params!.id === "404") return { notFound: true };
  return { props: { id: params!.id + ((globalThis as any).__probe ?? "") } };
};

export default function Post({ id }: Props) {
  const router = useRouter();
  return (
    <main>
      <h1>Post {id}</h1>
      <p>query {JSON.stringify(router.query)}</p>
      <Link href="/">Home</Link>
    </main>
  );
}
