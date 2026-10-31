import { getUser } from "./data";
import { Card } from "./theme";

const ServerContent = async () => {
  const user = await getUser();
  return <Card user={user} />;
};

export default ServerContent;
