export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <h1>Product {(await params).id}</h1>;
}
