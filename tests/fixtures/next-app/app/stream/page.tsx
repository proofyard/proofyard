import { Suspense } from "react";
import { db } from "../../components/users/db";

async function SlowList() {
  await db.gate; // テストが止めている間は届かない
  return <ul>{db.users.map((name) => <li key={name}>{name}</li>)}</ul>;
}

export default function Stream() {
  return (
    <>
      <h1>Stream</h1>
      <Suspense fallback={<p>Loading list</p>}>
        <SlowList />
      </Suspense>
    </>
  );
}
