// renderRoute: Next.js 本体の HTML と、Next.js 本体のクライアントによるハイドレーション
import { expect, test } from "bun:test";
import { renderRoute } from "proofyard";

test("ssr: HTML を document に入れる（JavaScript は動かさない）", async () => {
  const app = await renderRoute("/dashboard/users/123?tab=x", { mode: "ssr", cookies: { theme: "dark" } });
  expect(app.status).toBe(200);
  expect(app.getByRole("heading").textContent).toBe("User 123");
  expect(app.getByText("theme: dark")).toBeDefined();
  expect(document.documentElement.getAttribute("lang")).toBe("en");
});

test("client: ハイドレーションした Client Component を操作できる", async () => {
  const app = await renderRoute("/dashboard/users/123?tab=x");
  expect(location.pathname).toBe("/dashboard/users/123");
  const button = app.getByRole("button", { name: "likes: 3 at /dashboard/users/123" });
  await app.user.click(button);
  await app.findByRole("button", { name: "likes: 4 at /dashboard/users/123" });
});

test("redirect() は追いかける", async () => {
  const app = await renderRoute("/go", { mode: "ssr" });
  expect(app.url).toBe("/dashboard/users/1");
  expect(app.getByRole("heading").textContent).toBe("User 1");
});

test("client: Server Component の例外は dashboard/error.tsx の Error Boundary で表示する", async () => {
  const app = await renderRoute("/dashboard/users/boom");
  expect(app.status).toBe(500);
  // 本番モードでは例外のメッセージは届かない（本番版の React の、Server Components の例外を表す #441。Next.js 本番と同じ表示）
  expect((await app.findByRole("alert")).textContent).toStartWith("dashboard error: Minified React error #441;");
  expect(app.html).not.toContain("user load failed");
  expect(app.getByText("root layout")).toBeDefined();
});

test("client: notFound() は app/not-found.tsx を表示する", async () => {
  const app = await renderRoute("/dashboard/users/missing");
  expect(app.status).toBe(404);
  await app.findByText("custom not found");
});
