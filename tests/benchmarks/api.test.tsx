// Phase 8 / 仕様 20.5: Next.js モードの API の 1 テストあたりの時間と、その内訳（Flight、DOM の初期化、Server Action、テストどうしの後片付け）。
//   bun run bench:api（PROOFYARD_N で回数）
// 起動（プリロードのビルド）の時間は [proofyard] のログに出る
import { afterAll, beforeEach, expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
import { ensureDom } from "../../src/testing/render";
import { db } from "../fixtures/next-app/components/users/db";

const N = Number(process.env.PROOFYARD_N ?? 20);
const times: Record<string, number[]> = {};
const record = (name: string, ms: number) => (times[name] ??= []).push(ms);
// テストどうしの後片付け: テストの終わりから次のテストの始まりまで（プリロードの afterEach / beforeEach と bun test 自体）
let ended: { name: string; at: number } | undefined;
beforeEach(() => {
  if (ended) record(`cleanup after ${ended.name}`, performance.now() - ended.at);
});

const cases: Record<string, () => Promise<unknown>> = {
  "requestRoute /users": async () => expect(await (await requestRoute("/users")).text()).toContain("Alice"),
  // Flight: クライアントのナビゲーションと同じ RSC のリクエスト（Server Components を描画して Flight にする）
  "requestRoute /users RSC": async () => {
    const response = await requestRoute("/users?_rsc=", { headers: { RSC: "1" } });
    expect(response.headers.get("content-type")).toBe("text/x-component");
    expect(await response.text()).toContain("Alice");
  },
  "renderRoute /users ssr": async () => (await renderRoute("/users", { mode: "ssr" })).getByText("Alice"),
  "renderRoute /users client": async () => (await renderRoute("/users")).getByText("Alice"),
  "renderRoute + Server Action": async () => {
    const app = await renderRoute("/users");
    await app.user.type(app.getByRole("textbox", { name: "new user" }), "Bob");
    // Server Action: 送信からサーバーの処理、画面の更新まで
    const start = performance.now();
    await app.user.click(app.getByRole("button", { name: "Add" }));
    await app.findByText("Bob");
    record("Server Action (click → updated)", performance.now() - start);
  },
};

let domTest = false;
for (const [name, run] of Object.entries(cases)) {
  // DOM の初期化（turbo-dom のグローバル。1 プロセスに 1 回。最初の render / renderRoute がする）。サーバー側のコードに window を見せないよう、DOM を使う前に測る
  if (name.startsWith("renderRoute") && !domTest) {
    domTest = true;
    test("DOM install", () => {
      const start = performance.now();
      ensureDom();
      record("DOM install (once)", performance.now() - start);
      ended = undefined;
    });
  }
  for (let i = 0; i < N; i++)
    test(`${name} #${i}`, async () => {
      db.users = ["Alice"];
      const start = performance.now();
      await run();
      record(name, performance.now() - start);
      ended = { name, at: performance.now() };
    });
}

afterAll(() => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  // 1 回目はモジュールの読み込みなどを含むので分ける
  for (const [name, xs] of Object.entries(times))
    console.log(`${name.padEnd(42)} first ${xs[0]!.toFixed(1)}ms${xs.length > 1 ? `  median ${median(xs.slice(1)).toFixed(1)}ms` : ""}  (n=${xs.length})`);
});
