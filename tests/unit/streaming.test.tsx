// 最初の HTML のストリーミング（仕様 6.3 / 6.4）。テストがデータを止めている間の途中の状態を見る
import { beforeEach, expect, test } from "bun:test";
import { renderRoute } from "proofyard";
import { db } from "../fixtures/next-app/components/users/db";

beforeEach(() => {
  db.users = ["Alice"];
  db.gate = null;
});

test("streaming: シェル（fallback）で返り、データが届いたら中身（Client Mode）", async () => {
  const gate = Promise.withResolvers<void>();
  db.gate = gate.promise;
  const app = await renderRoute("/stream", { streaming: true });
  await app.waitForFallback();
  expect(app.getByRole("heading", { name: "Stream" })).toBeTruthy();
  expect(app.getByText("Loading list")).toBeTruthy();
  expect(app.queryByRole("listitem")).toBeNull();
  // シェルの時点でハイドレーション済み（Next.js のルーターが動く）
  expect(app.router.pathname).toBe("/stream");

  gate.resolve();
  await app.waitForComplete();
  expect(app.getByRole("listitem").textContent).toBe("Alice");
  expect(app.queryByText("Loading list")).toBeNull();
  expect(app.html).toEndWith("</body></html>");
});

test("streaming なしでは、Suspense の中身が表示されてから返る", async () => {
  const app = await renderRoute("/stream");
  expect(app.getByRole("listitem").textContent).toBe("Alice");
  expect(app.queryByText("Loading list")).toBeNull();
});

test("SSR Mode（JavaScript なし）は、後から届いた中身を表示しない（hidden のまま）", async () => {
  const gate = Promise.withResolvers<void>();
  db.gate = gate.promise;
  const app = await renderRoute("/stream", { mode: "ssr", streaming: true });
  gate.resolve();
  await app.waitForComplete();
  expect(app.getByText("Loading list")).toBeTruthy();
  expect(app.queryByRole("listitem")).toBeNull();
  expect(app.html).toContain('<div hidden id="S:0"><ul><li>Alice</li></ul></div>');
});

test("fallback が出ないページの waitForFallback はエラー", async () => {
  const app = await renderRoute("/dashboard", { streaming: true });
  await expect(app.waitForFallback()).rejects.toThrow("without showing a Suspense fallback");
});
