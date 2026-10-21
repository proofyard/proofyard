// Phase 8 / 仕様 20.5: Next.js モードの API の 1 テストあたりの時間（テストごとの後片付けを含む）。
//   bun run bench:api（PROOFYARD_N で回数）
// 起動（プリロードのビルド）の時間は [proofyard] のログに出る
import { afterAll, expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
import { db } from "../fixtures/next-app/components/users/db";

const N = Number(process.env.PROOFYARD_N ?? 20);
const times: Record<string, number[]> = {};
// 前のテストの終わり（後片付けの後）から次のテストの終わりまで
let last = performance.now();

const cases: Record<string, () => Promise<unknown>> = {
  "requestRoute /users": async () => expect(await (await requestRoute("/users")).text()).toContain("Alice"),
  "renderRoute /users ssr": async () => (await renderRoute("/users", { mode: "ssr" })).getByText("Alice"),
  "renderRoute /users client": async () => (await renderRoute("/users")).getByText("Alice"),
  "renderRoute + Server Action": async () => {
    const app = await renderRoute("/users");
    await app.user.type(app.getByRole("textbox", { name: "new user" }), "Bob");
    await app.user.click(app.getByRole("button", { name: "Add" }));
    await app.findByText("Bob");
  },
};

for (const [name, run] of Object.entries(cases))
  for (let i = 0; i < N; i++)
    test(`${name} #${i}`, async () => {
      db.users = ["Alice"];
      last = performance.now();
      await run();
      (times[name] ??= []).push(performance.now() - last);
    });

afterAll(() => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  // 1 回目はモジュールの読み込みなどを含むので分ける
  for (const [name, xs] of Object.entries(times))
    console.log(`${name.padEnd(28)} first ${xs[0]!.toFixed(1)}ms  median ${median(xs.slice(1)).toFixed(1)}ms  (n=${xs.length})`);
});
