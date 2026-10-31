const PhotoModal = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return <dialog open>Photo {id} (modal)</dialog>;
};
export default PhotoModal;
