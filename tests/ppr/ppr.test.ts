// Partial Prerendering（仕様 12 章）。静的シェルは本物の next build の .html と同じ（docs/handoff.md）
import { expect, test } from "bun:test";
import { prerenderRoute, requestRoute } from "proofyard";

test("静的シェル: \"use cache\" の結果は入り、cookies() / connection() の Suspense は fallback のまま", async () => {
  const result = await prerenderRoute("/dashboard");
  expect(result.status).toBe(200);
  expect(result.shell).toContain("<h1>Dashboard</h1>");
  expect(result.shell).toContain("Users: <!-- -->42");
  expect(result.shell).toContain("Loading greeting");
  expect(result.shell).toContain("Loading clock");
  expect(result.shell).not.toContain("Hello,");
  expect(result.postponed).toBe(true);
  expect(result.dynamicBoundaries).toEqual(["B:0", "B:1"]);
});

test("リクエストのときは動的な部分まで描画される", async () => {
  const html = await (await requestRoute("/dashboard", { cookies: { name: "Ann" } })).text();
  expect(html).toContain("Hello, <!-- -->Ann");
  expect(html).toContain("Rendered at request time");
});

test("動的な部分がなければシェルがページ全体", async () => {
  const result = await prerenderRoute("/about");
  expect(result.shell).toContain("<h1>About</h1>");
  expect(result.postponed).toBe(false);
  expect(result.dynamicBoundaries).toEqual([]);
});

test("Suspense の外の cookies() は next build と同じエラー", async () => {
  // expect(promise).rejects は使わない。Bun は待つ間に入れ子でイベントループを回し、Next.js のタスクの順番の前提が崩れる（docs/handoff.md）
  const error = await prerenderRoute("/blocking").catch((e) => e);
  expect(String(error)).toContain('Route "/blocking": Next.js encountered uncached or runtime data during prerendering');
});

test("動的なルート（generateStaticParams とフォールバックのシェル）は未対応（Fail Closed）", async () => {
  await expect(prerenderRoute("/products/1")).rejects.toThrow("Unsupported: prerenderRoute for dynamic routes (/products/[id])");
});
