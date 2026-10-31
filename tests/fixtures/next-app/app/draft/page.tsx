import { draftMode } from "next/headers";

const Draft = async () => {
  const { isEnabled } = await draftMode();
  return <h1>Draft {isEnabled ? "on" : "off"}</h1>;
};
export default Draft;
