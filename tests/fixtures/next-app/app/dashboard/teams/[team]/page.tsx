export default async function Team({ params }: { params: Promise<{ team: string }> }) {
  return <h1>Team {(await params).team}</h1>;
}
