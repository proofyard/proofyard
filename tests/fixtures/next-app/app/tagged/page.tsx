// updateTag（Server Action の中だけ）: タグの付いたキャッシュをすぐに無効にし、同じリクエストで新しい値を読む
import { unstable_cache } from "next/cache";
import { connection } from "next/server";

import { db } from "../../components/users/db";
import { bumpTagged } from "./actions";

// oxlint-disable-next-line eslint/require-await -- unstable_cache には Promise を返す関数を渡す
const readTagged = unstable_cache(async () => db.tagged, ["tagged"], {
  tags: ["tagged"],
});

const Tagged = async () => {
  await connection();
  return (
    <form action={bumpTagged}>
      <p>Tagged {await readTagged()}</p>
      <button type="submit">Bump</button>
    </form>
  );
};
export default Tagged;
