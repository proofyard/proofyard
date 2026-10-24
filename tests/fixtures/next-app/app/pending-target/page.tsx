import { connection } from "next/server";
import { db } from "../../components/users/db";

export default async function PendingTarget() {
  await connection();
  await db.gate; // テストが止めている間はナビゲーションが終わらない
  return <h1>Target page</h1>;
}
