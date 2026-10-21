import { load } from "fake-cached";

export default async function Page() {
  return <p>{await load()}</p>;
}
