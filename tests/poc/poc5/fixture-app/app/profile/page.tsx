import { getProfile } from "./data";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id = "me" } = await searchParams;
  const profile = await getProfile(id);
  return <h1>Profile: {profile.name}</h1>;
}
