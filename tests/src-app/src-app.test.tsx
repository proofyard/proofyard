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

test("instrumentation.ts の register と onRequestError（Next.js 本体が呼ぶ）", async () => {
  const g = globalThis as { registered?: number; requestErrors?: { message: string; path: string; routePath: string }[] };
  await requestRoute("/");
  expect(g.registered).toBe(1);
  const res = await requestRoute("/boom");
  expect(res.status).toBe(500);
  expect(g.requestErrors).toEqual([{ message: "boom", path: "/boom", routePath: "/boom" }]);
});

test("instrumentation-client.ts: ハイドレーションの前に動き、遷移の開始を受け取る", async () => {
  const app = await renderRoute("/");
  const w = window as unknown as { clientInstrumented?: boolean; transitions?: [string, string][] };
  expect(w.clientInstrumented).toBe(true);
  await app.router.push("/about");
  await app.findByRole("heading", { name: "About" });
  expect(w.transitions).toEqual([["/about", "push"]]);
});
