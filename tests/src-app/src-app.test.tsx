// src/ ディレクトリと tsconfig の paths（@/...）のアプリ
import { expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";

test("src/app のページと src/proxy.ts", async () => {
  const res = await requestRoute("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("x-src-proxy")).toBe("1");
  expect(await res.text()).toContain("<h1>Src App</h1>");
});

test("paths の import（Server Component と Client Component）", async () => {
  const app = await renderRoute("/");
  await app.user.click(app.getByRole("button", { name: "Hello, nobody" }));
  await app.findByRole("button", { name: "Hello, Alice" });
});
