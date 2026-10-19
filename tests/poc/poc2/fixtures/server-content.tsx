import * as React from "react";
import { Card } from "./theme";

export const serverReact = React;

export default async function ServerContent() {
  const user = await Promise.resolve({ name: "Alice" });
  return <Card user={user} />;
}
