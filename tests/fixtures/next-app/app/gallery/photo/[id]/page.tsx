const PhotoPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return <h1>Photo {id} (page)</h1>;
};
export default PhotoPage;
