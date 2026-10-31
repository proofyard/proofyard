import { Suspense } from "react";

import { db } from "../../components/users/db";

const SlowList = async () => {
  // テストが止めている間は届かない
  await db.gate;
  return (
    <ul>
      {db.users.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  );
};

const Stream = () => (
  <>
    <h1>Stream</h1>
    <Suspense fallback={<p>Loading list</p>}>
      <SlowList />
    </Suspense>
  </>
);
export default Stream;
