// Phase 7: Metadata、after()、Dynamic Imports（どれも Next.js 本体の処理をそのまま通す）
import { beforeEach, expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
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

test("Metadata: renderRoute の document.title", async () => {
  await renderRoute("/meta/world", { mode: "ssr" });
  expect(document.title).toBe("Post world | Fixture");
});

test("Metadata: 遷移すると document.title が変わる", async () => {
  const app = await renderRoute("/meta/a");
  await app.router.push("/meta/b");
  // Next.js は metadata を本文とは別に流すので、遷移のコミットより後に変わる
  await app.waitFor(() => expect(document.title).toBe("Post b | Fixture"));
});

test("after(): 応答を返したあとに動く", async () => {
  const res = await requestRoute("/after");
  expect(await res.text()).toContain("<h1>After</h1>");
  // 応答の本文を読み終えたあと
  await Bun.sleep(0);
  expect(db.afterLog).toEqual(["render", "after"]);
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
