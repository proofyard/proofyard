// Partial Prerendering（仕様 12 章）。静的シェルは本物の next build の .html と同じ（docs/handoff.md）
import { expect, test } from "bun:test";
import { createTestContext, prerenderRoute, renderRoute, requestRoute } from "proofyard";
import { stats } from "./fixture/app/dashboard/stats";
// @ts-expect-error 型のない偽物のパッケージ
import { stats as library } from "./fixture/node_modules/fake-cached";

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

test("動的なルート: ルートのパスならフォールバックのシェル（params を使うところは fallback のまま。next build の [id].html と同じ）", async () => {
  const result = await prerenderRoute("/products/[id]");
  expect(result.shell).toContain("<main><h1>Product page</h1><!--$?--><template id=\"B:0\"></template><p>Loading product</p><!--/$--></main>");
  expect(result.postponed).toBe(true);
});

test("動的なルート: generateStaticParams が返す URL は params が分かった静的シェル（next build の hello.html と同じ）", async () => {
  const result = await prerenderRoute("/posts/hello");
  expect(result.shell).toContain("<main><h1>Post <!-- -->hello</h1><!--$?--><template id=\"B:0\"></template><p>Loading views</p><!--/$--></main>");
  expect(result.postponed).toBe(true);
});

test("動的なルート: generateStaticParams が返さない URL は、next start と同じくフォールバックのシェル", async () => {
  const result = await prerenderRoute("/products/1");
  expect(result.shell).toContain("<main><h1>Product page</h1><!--$?--><template id=\"B:0\"></template><p>Loading product</p><!--/$--></main>");
  expect(result.postponed).toBe(true);
});

test("動的なルート: フォールバックのシェルが空でもよいルートは、next start と同じくその URL を prerender する", async () => {
  const result = await prerenderRoute("/posts/other");
  expect(result.shell).toContain("<main><h1>Post <!-- -->other</h1><!--$?--><template id=\"B:0\"></template><p>Loading views</p><!--/$--></main>");
  expect(result.postponed).toBe(true);
});

test("動的なルート: next build が空で書き出すフォールバックのシェル（params を Suspense の外で待つ）は空", async () => {
  const result = await prerenderRoute("/posts/[slug]");
  expect(result).toEqual({ status: 200, shell: "</body></html>", postponed: true, dynamicBoundaries: [] });
});

test("createTestContext: 同じテストの中では \"use cache\" の結果を再利用する（仕様 11.5）", async () => {
  const ctx = createTestContext({ cache: "isolated" });
  const before = stats.calls;
  await ctx.requestRoute("/dashboard");
  await ctx.requestRoute("/dashboard");
  expect(stats.calls - before).toBe(1);
  expect(ctx.cache.getInvalidatedTags()).toEqual([]);
});

test("createTestContext: テストが変われば分離される", async () => {
  const before = stats.calls;
  await createTestContext().requestRoute("/dashboard");
  expect(stats.calls - before).toBe(1);
});

test("createTestContext: \"isolated\" 以外のキャッシュは未対応（Fail Closed）", () => {
  expect(() => createTestContext({ cache: "shared" as "isolated" })).toThrow('Unsupported: createTestContext({ cache: "shared" })');
});

test("\"use cache: private\" は静的シェルに入らず、\"use cache: remote\" は入る（next build の private.html と同じ）", async () => {
  const result = await prerenderRoute("/private");
  expect(result.shell).toContain("<main><h1>Private</h1><p>Count: <!-- -->7</p><!--$?--><template id=\"B:0\"></template><p>Loading greeting</p><!--/$--></main>");
  expect(result.postponed).toBe(true);
});

test("\"use cache: private\" はリクエストの cookies() を読み、\"use cache: remote\" はリクエストをまたいで再利用する", async () => {
  const ctx = createTestContext();
  const remote = stats.remoteCalls;
  const before = stats.privateCalls;
  const ann = await (await ctx.requestRoute("/private", { cookies: { name: "Ann" } })).text();
  const bob = await (await ctx.requestRoute("/private", { cookies: { name: "Bob" } })).text();
  expect(ann).toContain("Hello, Ann");
  expect(bob).toContain("Hello, Bob");
  expect(stats.remoteCalls - remote).toBe(1);
  // private はリクエストをまたいで共有しない
  expect(stats.privateCalls - before).toBe(2);
});

test('node_modules のパッケージの "use cache"（静的シェルに入り、同じテストの中では再利用する）', async () => {
  const ctx = createTestContext();
  const before = library.calls;
  expect((await ctx.prerenderRoute("/library")).shell).toContain("<p>from library</p>");
  expect(await (await ctx.requestRoute("/library")).text()).toContain("<p>from library</p>");
  expect(library.calls - before).toBe(1);
});

test("next build の prefetch hints を使う Link の先読みとナビゲーション（静的なシェルの先読みから、動的な部分はリクエストのときに）", async () => {
  const app = await renderRoute("/links", { cookies: { name: "Ann" } });
  await app.user.click(app.getByRole("link", { name: "Dashboard" }));
  await app.findByText("Hello, Ann");
  expect(app.getByRole("heading").textContent).toBe("Dashboard");
  expect(app.router.pathname).toBe("/dashboard");
  await app.router.back();
  await app.user.click(app.getByRole("link", { name: "Hello post" }));
  await app.findByText("Views: 7");
  expect(app.getByRole("heading").textContent).toBe("Post hello");
  expect(app.errors).toEqual([]);
});
