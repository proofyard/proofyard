// アプリのコードはネイティブで読み込むので、mock.module でデータ取得を差し替えられる
import { expect, mock, test } from "bun:test";
import { join } from "node:path";
import type { NextResponseResult } from "./preload";

const { request } = (globalThis as any).__proofyardNext as { request: (url: string) => Promise<NextResponseResult> };

const getProfile = mock(async (id: string) => ({ name: `Mocked ${id}` }));
mock.module(join(import.meta.dir, "fixture-app/app/profile/data.ts"), () => ({ getProfile }));

test("Server Component が使うモジュールを mock.module で差し替える", async () => {
  const res = await request("/profile?id=42");
  expect(res.status).toBe(200);
  expect(res.html.replace(/<!-- -->/g, "")).toContain("<h1>Profile: Mocked 42</h1>");
  expect(getProfile).toHaveBeenCalledTimes(1);
  expect(getProfile).toHaveBeenCalledWith("42");
});
