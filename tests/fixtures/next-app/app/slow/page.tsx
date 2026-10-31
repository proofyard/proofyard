import { db } from "../../components/users/db";

const Slow = async () => {
  // テストが止めている間は描画が終わらない
  await db.gate;
  return <h1>Slow page</h1>;
};
export default Slow;
