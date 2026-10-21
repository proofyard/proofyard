export default async function Profile({ params }: { params: Promise<{ name: string }> }) {
  return <h1>Profile {(await params).name}</h1>;
}
