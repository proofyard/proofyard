import { db } from "../../components/users/db";

export default async function Slow() {
  await db.gate; // テストが止めている間は描画が終わらない
  return <h1>Slow page</h1>;
}
