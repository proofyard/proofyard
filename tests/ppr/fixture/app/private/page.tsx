import { cookies } from "next/headers";
import { Suspense } from "react";

import { stats } from "../dashboard/stats";

// "use cache: private" はリクエストごとのキャッシュ（cookies() を読める）。静的シェルには入らない
// oxlint-disable-next-line eslint/func-style -- "use cache" / "use server" の関数はアロー関数にせず関数宣言のまま残す
async function getGreeting() {
  "use cache: private";
  stats.privateCalls += 1;
  const cookieStore = await cookies();
  return `Hello, ${cookieStore.get("name")?.value ?? "guest"}`;
}

// "use cache: remote" は自前でホストする場合、"use cache" と同じメモリのハンドラー
// oxlint-disable-next-line eslint/func-style, eslint/require-await -- "use cache" / "use server" の関数はアロー関数にせず関数宣言のまま、async で残す
async function getCount() {
  "use cache: remote";
  stats.remoteCalls += 1;
  return 7;
}

const Greeting = async () => <p>{await getGreeting()}</p>;

const Page = async () => (
  <main>
    <h1>Private</h1>
    <p>Count: {await getCount()}</p>
    <Suspense fallback={<p>Loading greeting</p>}>
      <Greeting />
    </Suspense>
  </main>
);
export default Page;
