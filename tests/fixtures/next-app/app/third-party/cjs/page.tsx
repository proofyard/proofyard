import Hello from "fake-cjs-hello";
import Badge, { Toggle } from "fake-cjs-ui";
import { connection } from "next/server";

// CommonJS の "use client" のパッケージ（default と名前付きの export、module.exports そのもの）
export default async function Page() {
  await connection();
  return (
    <main>
      <Badge>cjs</Badge>
      <Toggle label="Power" />
      <Hello />
    </main>
  );
}
