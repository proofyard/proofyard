import { after } from "next/server";
import { db } from "../../components/users/db";

export default async function AfterPage({ searchParams }: { searchParams: Promise<{ slow?: string }> }) {
  const { slow } = await searchParams;
  db.afterLog.push("render");
  after(() => {
    db.afterLog.push("after");
  });
  if (slow)
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      db.afterLog.push("slow after");
    });
  return <h1>After</h1>;
}
