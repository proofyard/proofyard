// アプリのコードはネイティブで読み込むので、mock.module でデータ取得を差し替えられる
import { expect, mock, test } from "bun:test";
import nodePath from "node:path";

import { requestRoute } from "proofyard";

const getProfile = mock((id: string) =>
  Promise.resolve({ name: `Mocked ${id}` })
);
mock.module(
  nodePath.join(import.meta.dir, "fixture-app/app/profile/data.ts"),
  () => ({
    getProfile,
  })
);

test("Server Component が使うモジュールを mock.module で差し替える", async () => {
  const res = await requestRoute("/profile?id=42");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html.replaceAll("<!-- -->", "")).toContain(
    "<h1>Profile: Mocked 42</h1>"
  );
  expect(getProfile).toHaveBeenCalledTimes(1);
  expect(getProfile).toHaveBeenCalledWith("42");
});
