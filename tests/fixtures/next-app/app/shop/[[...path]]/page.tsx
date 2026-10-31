// 省略できる catch-all のセグメント（/shop も入る）
const Shop = async ({ params }: { params: Promise<{ path?: string[] }> }) => {
  const { path } = await params;
  return <h1>{path ? `Shop ${path.join(" / ")}` : "Shop top"}</h1>;
};
export default Shop;
