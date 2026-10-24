// basePath・trailingSlash・forbidden() / unauthorized()・global-error.tsx のアプリ（本物の Next.js との比較は tests/compatibility/config-app.test.ts）
import { expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";

test("basePath と trailingSlash: 末尾の / へのリダイレクトと、Link・usePathname", async () => {
  const res = await requestRoute("/base/about");
  expect(res.status).toBe(308);
  expect(res.headers.get("location")).toBe("/base/about/");
  const app = await renderRoute("/base/");
  const link = app.getByRole("link", { name: "About" });
  expect(link.getAttribute("href")).toBe("/base/about/");
  await app.user.click(link);
  await app.findByRole("heading", { name: "About" });
  expect(location.pathname).toBe("/base/about/");
  expect(app.getByText("Path /about/")).toBeTruthy();
});

test("basePath の外の URL は 404", async () => {
  expect((await requestRoute("/about/")).status).toBe(404);
});

test("forbidden() は 403 と forbidden.tsx", async () => {
  const app = await renderRoute("/base/admin/");
  expect(app.status).toBe(403);
  await app.findByRole("heading", { name: "Forbidden here" });
  const allowed = await renderRoute("/base/admin/", { cookies: { role: "admin" } });
  await allowed.findByRole("heading", { name: "Admin area" });
});

test("unauthorized() は 401 と unauthorized.tsx", async () => {
  const app = await renderRoute("/base/account/");
  expect(app.status).toBe(401);
  await app.findByRole("heading", { name: "Please sign in" });
});

test("error.tsx のない例外は global-error.tsx", async () => {
  const app = await renderRoute("/base/boom/");
  expect(app.status).toBe(500);
  await app.findByRole("heading", { name: "Global failure" });
  expect(app.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("Route Handler の request.url は basePath を除いたパス", async () => {
  expect(await (await requestRoute("/base/api/ping/")).json()).toEqual({ path: "/api/ping/" });
});
