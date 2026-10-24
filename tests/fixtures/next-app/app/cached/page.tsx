// unstable_cache: 同じキーの結果を使い回す（タグで無効にできる）
import { unstable_cache } from "next/cache";
import { connection } from "next/server";
import { db } from "../../components/users/db";

const countUsers = unstable_cache(
  async () => {
    db.cacheCalls++;
    return db.users.length;
  },
  ["count-users"],
  { tags: ["users-count"] },
);

export default async function Cached() {
  await connection();
  return <h1>Cached users {await countUsers()}</h1>;
}
