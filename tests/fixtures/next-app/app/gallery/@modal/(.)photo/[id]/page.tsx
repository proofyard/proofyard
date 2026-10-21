export default async function PhotoModal({ params }: { params: Promise<{ id: string }> }) {
  return <dialog open>Photo {(await params).id} (modal)</dialog>;
}
