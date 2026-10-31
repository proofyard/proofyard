import { connection } from "next/server";

import { db } from "../../components/users/db";

const PendingTarget = async () => {
  await connection();
  // テストが止めている間はナビゲーションが終わらない
  await db.gate;
  return <h1>Target page</h1>;
};
export default PendingTarget;
