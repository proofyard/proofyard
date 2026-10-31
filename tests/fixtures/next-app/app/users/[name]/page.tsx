const Profile = async ({ params }: { params: Promise<{ name: string }> }) => {
  const { name } = await params;
  return <h1>Profile {name}</h1>;
};
export default Profile;
