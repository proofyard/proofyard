// catch-all のセグメント
const Doc = async ({ params }: { params: Promise<{ slug: string[] }> }) => {
  const { slug } = await params;
  return (
    <h1>
      Doc {slug.join(" / ")} ({slug.length})
    </h1>
  );
};
export default Doc;
