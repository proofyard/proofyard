import { Card } from "./theme";

const BadPage = () => (
  <Card user={{ name: "Bob" }} format={(name) => name.toUpperCase()} />
);

export default BadPage;
