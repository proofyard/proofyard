// catch-all のセグメント
export default async function Doc({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return <h1>Doc {slug.join(" / ")} ({slug.length})</h1>;
}
