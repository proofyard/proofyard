import { getItems } from "./items";
import { ItemsView } from "./items-view";

const Page = async () => <ItemsView items={await getItems()} />;

export default Page;
