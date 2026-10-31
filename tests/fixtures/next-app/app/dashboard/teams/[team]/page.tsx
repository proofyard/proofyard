const Team = async ({ params }: { params: Promise<{ team: string }> }) => {
  const { team } = await params;
  return <h1>Team {team}</h1>;
};
export default Team;
