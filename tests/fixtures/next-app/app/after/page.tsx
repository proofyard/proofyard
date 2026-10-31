import { setTimeout as sleep } from "node:timers/promises";

import { after } from "next/server";

import { db } from "../../components/users/db";

const AfterPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ slow?: string }>;
}) => {
  const { slow } = await searchParams;
  db.afterLog.push("render");
  after(() => {
    db.afterLog.push("after");
  });
  if (slow) {
    after(async () => {
      await sleep(50);
      db.afterLog.push("slow after");
    });
  }
  return <h1>After</h1>;
};
export default AfterPage;
