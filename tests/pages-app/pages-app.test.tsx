// Pages Router（pages/）と App Router（app/）が同居するアプリ（本物の Next.js との比較は tests/compatibility/pages-app.test.ts）
import { expect, mock, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";

const nextData = async (res: Response) => JSON.parse((await res.text()).match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/)![1]!);

test("getServerSideProps は毎回のリクエストで動き、cookie を読む", async () => {
  const res = await requestRoute("/", { cookies: { name: "Alice" } });
  expect(res.status).toBe(200);
  const data = await nextData(res);
  expect(data.props.pageProps).toEqual({ message: "Hello, Alice" });
  expect(data.gssp).toBe(true);
  expect((await nextData(await requestRoute("/"))).props.pageProps).toEqual({ message: "Hello, guest" });
});

test("getStaticProps と getStaticPaths（fallback: blocking と notFound）", async () => {
  expect((await nextData(await requestRoute("/about"))).props.pageProps).toEqual({ built: "at build time" });
  for (const id of ["1", "7"]) {
    const res = await requestRoute(`/posts/${id}`);
    expect(res.status).toBe(200);
    expect((await nextData(res)).props.pageProps).toEqual({ id });
  }
  const missing = await requestRoute("/posts/404");
  expect(missing.status).toBe(404);
  // 同居するアプリの 404 は App Router の not-found（next start と同じ。tests/compatibility/pages-app.test.ts）
});

test("/_next/data の JSON", async () => {
  const res = await requestRoute("/_next/data/proofyard/posts/3.json");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ pageProps: { id: "3" }, __N_SSG: true });
});

test("getServerSideProps の redirect と、存在しないページ", async () => {
  const res = await requestRoute("/redirect");
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("/about");
  expect((await requestRoute("/nothing")).status).toBe(404);
});

test("API Routes", async () => {
  expect(await (await requestRoute("/api/hello?name=Bob")).json()).toEqual({ hello: "Bob", method: "GET" });
  expect(await (await requestRoute("/api/hello", { method: "POST" })).json()).toEqual({ hello: "world", method: "POST" });
});

test("ハイドレーション: _app の Context、next/head、状態", async () => {
  const app = await renderRoute("/", { cookies: { name: "Alice" } });
  expect(app.getByRole("heading", { name: "Hello, Alice" })).toBeTruthy();
  expect(app.getByText("theme: dark")).toBeTruthy();
  expect(document.title).toBe("Pages home");
  await app.user.click(app.getByRole("button", { name: "count 0" }));
  await app.findByRole("button", { name: "count 1" });
});

test("Link・router.push・router.back", async () => {
  const app = await renderRoute("/");
  await app.user.click(app.getByRole("link", { name: "About" }));
  await app.findByText("pathname /about");
  expect(location.pathname).toBe("/about");
  await app.user.click(app.getByRole("button", { name: "Go to post 2" }));
  await app.findByRole("heading", { name: "Post 2" });
  expect(app.getByText(`query ${JSON.stringify({ from: "about", id: "2" })}`)).toBeTruthy();
  expect(location.pathname + location.search).toBe("/posts/2?from=about");
  await app.router.back();
  await app.findByText("pathname /about");
  await app.router.push("/posts/5");
  await app.findByRole("heading", { name: "Post 5" });
});

test("mode: ssr はハイドレーションしない", async () => {
  const app = await renderRoute("/", { mode: "ssr" });
  expect(app.getByRole("heading", { name: "Hello, guest" })).toBeTruthy();
  await app.user.click(app.getByRole("button", { name: "count 0" }));
  expect(app.getByRole("button", { name: "count 0" })).toBeTruthy();
});

test("Pages Router の router.refresh は Fail Closed", async () => {
  const app = await renderRoute("/about");
  expect(() => app.router.refresh()).toThrow("Unsupported");
});

test("Pages Router のバンドルに入るモジュールの mock.module は Fail Closed", () => {
  expect(() => mock.module("./fixture/lib/greeting", () => ({ greeting: () => "mocked" }))).toThrow("Unsupported");
});

test("同じアプリの App Router のページ", async () => {
  const app = await renderRoute("/hybrid");
  await app.findByRole("heading", { name: "App Router page" });
});
