import { Card } from "./theme";
import { getUser } from "./data";

export default async function ServerContent() {
  const user = await getUser();
  return <Card user={user} />;
}
