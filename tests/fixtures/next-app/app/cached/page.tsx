// unstable_cache: 同じキーの結果を使い回す（タグで無効にできる）
import { unstable_cache } from "next/cache";
import { connection } from "next/server";

import { db } from "../../components/users/db";

const countUsers = unstable_cache(
  // oxlint-disable-next-line eslint/require-await -- unstable_cache には Promise を返す関数を渡す
  async () => {
    db.cacheCalls += 1;
    return db.users.length;
  },
  ["count-users"],
  { tags: ["users-count"] }
);

const Cached = async () => {
  await connection();
  return <h1>Cached users {await countUsers()}</h1>;
};
export default Cached;
