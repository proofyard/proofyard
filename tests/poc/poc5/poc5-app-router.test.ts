// PoC 5: 実際の Next.js App Router アプリを、Next.js サーバーなしで Next.js 本体の handler に通す。
// 期待値は Next.js 本体の挙動（本番モード）をそのまま確認する。
import { expect, test } from "bun:test";
import { requestRoute, type RequestRouteOptions } from "proofyard";

type NextResponseResult = { status: number; headers: Headers; html: string };
const request = async (url: string, options?: RequestRouteOptions): Promise<NextResponseResult> => {
  const res = await requestRoute(url, options);
  return { status: res.status, headers: res.headers, html: await res.text() };
};

// HTML 本体（script と React のテキスト区切りコメントを除く）
const body = (res: NextResponseResult) => res.html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!-- -->/g, "");
// HTML に埋め込まれた RSC ペイロード（self.__next_f）
const flight = (res: NextResponseResult) =>
  [...res.html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)].map((m) => JSON.parse(m[1]!)[1] ?? "").join("");

test("ルートのレイアウトとページ", async () => {
  const res = await request("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(body(res)).toContain("<header>root layout</header><h1>Home</h1>");
  // クライアントがハイドレーションに使う RSC ペイロードも HTML に入る
  expect(flight(res)).toContain('"children":"Home"');
});

test("ルートグループ (marketing) は URL に出ない", async () => {
  const res = await request("/about");
  expect(res.status).toBe(200);
  expect(body(res)).toContain("<h1>About</h1>");
});

test("ネストしたレイアウト・動的ルート・searchParams・cookies・headers・Client Component の SSR", async () => {
  const res = await request("/dashboard/users/123?tab=x", { cookies: { theme: "dark" }, headers: { "user-agent": "proofyard-test" } });
  expect(res.status).toBe(200);
  expect(body(res)).toContain(
    "<header>root layout</header><section><nav>dashboard nav (proofyard-test)</nav>" +
      "<article><h1>User 123</h1><p>tab: x</p><p>theme: dark</p>" +
      '<button type="button">likes: 3 at /dashboard/users/123</button></article>',
  );
});

test("cookie がなければ既定値", async () => {
  const res = await request("/dashboard/users/7");
  expect(body(res)).toContain("<p>theme: light</p>");
});

test("redirect() は 307 と Location", async () => {
  const res = await request("/go");
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("/dashboard/users/1");
});

test("notFound() は 404 と app/not-found.tsx", async () => {
  const res = await request("/dashboard/users/missing");
  expect(res.status).toBe(404);
  expect(body(res)).toContain('<meta name="robots" content="noindex"/>');
  // Suspense の外で投げられたので HTML はエラー用の空シェル。not-found はペイロードからクライアントで描く（Next.js 本体の挙動）
  expect(body(res)).toContain('<html id="__next_error__">');
  expect(flight(res)).toContain('"notFound":[["$","p",null,{"children":"custom not found"}]');
});

test("Server Component の例外は 500 で、dashboard/error.tsx の Error Boundary がペイロードに入る", async () => {
  const res = await request("/dashboard/users/boom");
  expect(res.status).toBe(500);
  expect(body(res)).toContain('<html id="__next_error__">');
  // error.tsx は Client Component（Client Reference として送られる）
  expect(flight(res)).toMatch(/"[^"]*\/fixture-app\/app\/dashboard\/error\.tsx"/);
  // 本番モードでは例外のメッセージをクライアントに送らない
  expect(res.html).not.toContain("user load failed");
});

test("どのルートにも一致しない URL は 404 とルートの not-found（next start と同じく _not-found ページ）", async () => {
  const res = await request("/nope/a/b");
  expect(res.status).toBe(404);
  expect(body(res)).toContain("<header>root layout</header>");
  expect(body(res)).toContain("custom not found");
});
