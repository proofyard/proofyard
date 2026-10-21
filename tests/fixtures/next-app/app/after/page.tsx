import { after } from "next/server";
import { db } from "../../components/users/db";

export default function AfterPage() {
  db.afterLog.push("render");
  after(() => {
    db.afterLog.push("after");
  });
  return <h1>After</h1>;
}
