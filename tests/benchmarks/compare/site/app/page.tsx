import { getItems } from "./items";
import { ItemsView } from "./items-view";

export default async function Page() {
  return <ItemsView items={await getItems()} />;
}
