export default async function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
  return <h1>Photo {(await params).id} (page)</h1>;
}
