import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { stats } from "./stats";

async function getStats() {
  "use cache";
  stats.calls++;
  return { users: 42 };
}

async function Stats() {
  const { users } = await getStats();
  return <p>Users: {users}</p>;
}

async function Greeting() {
  const name = (await cookies()).get("name")?.value ?? "guest";
  return <p>Hello, {name}</p>;
}

async function Clock() {
  await connection();
  return <p>Rendered at request time</p>;
}

export default function Page() {
  return (
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
}
