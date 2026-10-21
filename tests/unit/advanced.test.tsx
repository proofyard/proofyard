// Phase 7 / 仕様 16 章: Metadata、after()、Dynamic Imports など（どれも Next.js 本体の処理をそのまま通す）
import { beforeEach, expect, test } from "bun:test";
import { flushAfter, renderRoute, requestRoute } from "proofyard";
import { db } from "../fixtures/next-app/components/users/db";

beforeEach(() => {
  db.afterLog = [];
});

test("Metadata: layout の title.template と generateMetadata", async () => {
  const html = await (await requestRoute("/meta/hello")).text();
  expect(html).toContain("<title>Post hello | Fixture</title>");
  expect(html).toContain('<meta name="description" content="Proofyard fixture"/>');
  expect(html).toContain('<meta property="og:title" content="OG hello"/>');
});

test("Metadata: renderRoute の result.metadata（仕様 16.1）", async () => {
  const app = await renderRoute("/meta/world", { mode: "ssr" });
  expect(app.metadata.title).toBe("Post world | Fixture");
  expect(app.metadata.description).toBe("Proofyard fixture");
  expect(app.metadata.get("og:title")).toBe("OG world");
  expect(app.metadata.get("theme-color")).toBe("#123456");
  expect(app.metadata.get("missing")).toBeNull();
});

test("Metadata: 遷移すると metadata が変わり、前のページのものは残らない", async () => {
  const app = await renderRoute("/meta/a");
  await app.router.push("/meta/b");
  // Next.js は metadata を本文とは別に流す。ルーターの操作は React の作業が落ち着くまで待つので、この時点で変わっている
  expect(app.metadata.title).toBe("Post b | Fixture");
  expect(app.metadata.get("og:title")).toBe("OG b");
  expect(document.head.querySelectorAll("title")).toHaveLength(1);
  expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
});

test("Metadata: generateViewport と icon.svg", async () => {
  const html = await (await requestRoute("/meta/hello")).text();
  expect(html).toContain('<meta name="theme-color" content="#123456"/>');
  expect(html).toMatch(/<link rel="icon" href="\/icon\.svg\?[0-9a-f]+" type="image\/svg\+xml" sizes="any"\/>/);
  const icon = await requestRoute("/icon.svg");
  expect(icon.headers.get("content-type")).toBe("image/svg+xml");
});

test("Metadata のルート: sitemap.ts と robots.ts", async () => {
  const sitemap = await requestRoute("/sitemap.xml");
  expect(sitemap.headers.get("content-type")).toBe("application/xml");
  expect(await sitemap.text()).toContain("<loc>https://example.com/users</loc>");
  const robots = await requestRoute("/robots.txt");
  expect(await robots.text()).toBe("User-Agent: *\nDisallow: /admin\n\n");
});

test("Metadata: opengraph-image.tsx（next/og の ImageResponse）", async () => {
  const html = await (await requestRoute("/og")).text();
  expect(html).toContain('<meta property="og:image:width" content="120"/>');
  expect(html).toContain('<meta property="og:image:alt" content="OG image"/>');
  const path = html.match(/<meta property="og:image" content="http:\/\/localhost:3000([^"]+)"/)![1]!;
  const image = await requestRoute(path);
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
  // PNG のシグネチャ
  expect([...new Uint8Array(await image.arrayBuffer()).slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
});

test("after(): 応答を返したあとに動く", async () => {
  const res = await requestRoute("/after");
  expect(await res.text()).toContain("<h1>After</h1>");
  await flushAfter();
  expect(db.afterLog).toEqual(["render", "after"]);
});

test("after(): renderRoute の lifecycle.flushAfter と、後から終わる処理", async () => {
  const app = await renderRoute("/after?slow=1", { mode: "ssr" });
  await app.lifecycle.flushAfter();
  expect(db.afterLog).toEqual(["render", "after", "slow after"]);
});

test("Dynamic Imports: next/dynamic（ssr: false）と import()", async () => {
  const app = await renderRoute("/lazy", { mode: "ssr" });
  // SSR では ssr: false のものは描画されない
  expect(app.queryByText(/Chart ready/)).toBeNull();
  const client = await renderRoute("/lazy");
  await client.findByText("Chart ready (object)");
  await client.user.click(client.getByRole("button", { name: "Open notes" }));
  await client.findByText("Notes loaded");
});

test("Hydration Mismatch: ブラウザと同じく window に報告され、errors に入る", async () => {
  const app = await renderRoute("/mismatch");
  // React はサーバーの HTML を捨ててクライアントで描画し直す
  await app.findByText("Rendered on client");
  expect(app.errors).toHaveLength(1);
  expect(String(app.errors[0])).toContain("#418");
});

test("Hydration Mismatch がなければ errors は空", async () => {
  const app = await renderRoute("/lazy");
  await app.findByText("Chart ready (object)");
  expect(app.errors).toEqual([]);
});

test("Concurrent Rendering: useDeferredValue と startTransition の中の router.push", async () => {
  db.gate = null;
  const app = await renderRoute("/concurrent");
  await app.user.type(app.getByRole("textbox", { name: "Filter" }), "a");
  await app.waitFor(() => expect(app.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Alice", "Carol", "Dave"]));
  await app.user.click(app.getByRole("button", { name: "Go slow" }));
  await app.findByRole("heading", { name: "Slow page" });
  expect(location.pathname).toBe("/slow");
});

test("環境変数（.env）、server-only、next/image", async () => {
  const app = await renderRoute("/compat");
  // サーバーは .env の値（テストでは Next.js と同じく .env.local を読まない）。NEXT_PUBLIC_* はブラウザのバンドルに埋め込まれる
  expect(app.getByText(/Server secret/).textContent).toBe("Server secret: from-dotenv");
  expect(app.getByText(/Client label/).textContent).toBe("Client label: Fixture site");
  expect(app.getByRole("img", { name: "Logo" }).getAttribute("src")).toBe("/logo.svg");
  expect(app.errors).toEqual([]);
});

test("next/image の画像の最適化（/_next/image）", async () => {
  const res = await requestRoute("/_next/image?url=%2Fdot.png&w=32&q=75", { headers: { accept: "image/webp" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/webp");
});

test("CSS: CSS Modules のクラス名は next build と同じ（Server / Client Component）。普通の CSS は読み込むだけ", async () => {
  const html = await (await requestRoute("/styled")).text();
  expect(html).toContain('<h1 class="page_title__NlRtp">');
  const app = await renderRoute("/styled");
  expect(app.getByRole("heading").className).toBe("page_title__NlRtp");
  expect(app.getByRole("button", { name: "Styled" }).className).toBe("styled-button_button__wkz7j");
  expect(app.errors).toEqual([]);
});

test("next/font/local: クラス名とフォント名は Next.js のローダーが作る", async () => {
  const app = await renderRoute("/fonts");
  const text = app.getByText("Branded");
  expect(text.className).toMatch(/^__className_[0-9a-f]{6} __variable_[0-9a-f]{6}$/);
  expect(text.dataset.family).toBe("'brand'");
  expect(app.errors).toEqual([]);
});

test("サードパーティの \"use client\"（パッケージの奥のファイル、別のパッケージ）は Client Reference になる", async () => {
  const app = await renderRoute("/third-party");
  // サーバーで実行されていれば、react-server の React に useState がなく失敗する
  await app.user.click(app.getByRole("button", { name: "CLICKS: 0" }));
  await app.findByRole("button", { name: "CLICKS: 1" });
  await app.waitFor(() => expect(app.getByText("tip").dataset.mounted).toBe("true"));
  expect(app.errors).toEqual([]);
});

test('node_modules の "use cache" は変換できないので、そのページは Fail Closed（500）', async () => {
  const res = await requestRoute("/third-party/cached");
  expect(res.status).toBe(500);
});

test("サードパーティの exports の react-server の条件は、Next.js の rsc 層と同じく react-server のファイル", async () => {
  const html = await (await requestRoute("/third-party/server")).text();
  expect(html).toContain("server build<!-- --> (<!-- -->react-server<!-- -->)");
});
