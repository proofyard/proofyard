import { draftMode } from "next/headers";

export default async function Draft() {
  const { isEnabled } = await draftMode();
  return <h1>Draft {isEnabled ? "on" : "off"}</h1>;
}
