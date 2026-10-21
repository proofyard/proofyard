// サードパーティの状態管理ライブラリ（zustand / jotai / Redux Toolkit）
import { expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";

const names = ["zustand", "jotai", "redux"];

test("SSR の HTML に初期状態が入る", async () => {
  const html = await (await requestRoute("/state")).text();
  for (const name of names) expect(html).toContain(`${name}: <!-- -->0`);
});

test("ハイドレーション後にクリックで更新され、ソフトナビゲーションの後も残る", async () => {
  const app = await renderRoute("/state");
  for (const name of names) await app.user.click(app.getByRole("button", { name: `${name}: 0` }));
  await app.user.click(app.getByRole("link", { name: "Other" }));
  await app.findByRole("heading", { name: "Other" });
  for (const name of names) expect(app.getByRole("button", { name: `${name}: 1` })).toBeTruthy();
});

test("モジュールのスコープのストアは前のテストから漏れない", async () => {
  const app = await renderRoute("/state");
  for (const name of names) expect(app.getByRole("button", { name: `${name}: 0` })).toBeTruthy();
});
