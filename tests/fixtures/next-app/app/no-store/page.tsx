// unstable_noStore(): 静的にせず、リクエストのたびに描画する
import { unstable_noStore } from "next/cache";
import { db } from "../../components/users/db";

export default function NoStore() {
  unstable_noStore();
  return <h1>Users {db.users.length}</h1>;
}
