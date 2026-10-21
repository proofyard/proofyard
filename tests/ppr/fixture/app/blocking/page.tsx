import { cookies } from "next/headers";

// Suspense の外で cookies() を読む（next build は「Uncached data was accessed outside of <Suspense>」で失敗する）
export default async function Page() {
  const name = (await cookies()).get("name")?.value ?? "guest";
  return <p>Hello, {name}</p>;
}
