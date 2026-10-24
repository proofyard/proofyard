// error.tsx がないので、例外は global-error.tsx が受ける
import { connection } from "next/server";

export default async function Boom() {
  await connection();
  throw new Error("boom");
}
