import { cookies } from "next/headers";

// Suspense の外で cookies() を読む（next build は「Uncached data was accessed outside of <Suspense>」で失敗する）
const Page = async () => {
  const cookieStore = await cookies();
  const name = cookieStore.get("name")?.value ?? "guest";
  return <p>Hello, {name}</p>;
};
export default Page;
