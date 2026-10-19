import { Card } from "./theme";

export default function BadPage() {
  return <Card user={{ name: "Bob" }} format={(name) => name.toUpperCase()} />;
}
