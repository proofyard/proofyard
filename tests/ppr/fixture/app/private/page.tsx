import { Suspense } from "react";
import { cookies } from "next/headers";
import { stats } from "../dashboard/stats";

// "use cache: private" はリクエストごとのキャッシュ（cookies() を読める）。静的シェルには入らない
async function getGreeting() {
  "use cache: private";
  stats.privateCalls++;
  return `Hello, ${(await cookies()).get("name")?.value ?? "guest"}`;
}

// "use cache: remote" は自前でホストする場合、"use cache" と同じメモリのハンドラー
async function getCount() {
  "use cache: remote";
  stats.remoteCalls++;
  return 7;
}

async function Greeting() {
  return <p>{await getGreeting()}</p>;
}

export default async function Page() {
  return (
    <main>
      <h1>Private</h1>
      <p>Count: {await getCount()}</p>
      <Suspense fallback={<p>Loading greeting</p>}>
        <Greeting />
      </Suspense>
    </main>
  );
}
