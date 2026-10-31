import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";

import { stats } from "./stats";

// oxlint-disable-next-line eslint/func-style, eslint/require-await -- "use cache" / "use server" の関数はアロー関数にせず関数宣言のまま、async で残す
async function getStats() {
  "use cache";
  stats.calls += 1;
  return { users: 42 };
}

const Stats = async () => {
  const { users } = await getStats();
  return <p>Users: {users}</p>;
};

const Greeting = async () => {
  const cookieStore = await cookies();
  const name = cookieStore.get("name")?.value ?? "guest";
  return <p>Hello, {name}</p>;
};

const Clock = async () => {
  await connection();
  return <p>Rendered at request time</p>;
};

const Page = () => (
  <main>
    <h1>Dashboard</h1>
    <Stats />
    <Suspense fallback={<p>Loading greeting</p>}>
      <Greeting />
    </Suspense>
    <Suspense fallback={<p>Loading clock</p>}>
      <Clock />
    </Suspense>
  </main>
);
export default Page;
