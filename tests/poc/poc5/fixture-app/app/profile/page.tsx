import { getProfile } from "./data";

const ProfilePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) => {
  const { id = "me" } = await searchParams;
  const profile = await getProfile(id);
  return <h1>Profile: {profile.name}</h1>;
};

export default ProfilePage;
