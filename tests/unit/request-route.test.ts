// requestRoute: next start と同じルーターで、Proxy・next.config・Route Handler を通す
import { expect, test } from "bun:test";
import { requestRoute } from "proofyard";

test("Route Handler: params / cookies / Proxy が足したリクエストヘッダー", async () => {
  const res = await requestRoute("/api/users/Alice", { cookies: { theme: "dark", session: "Bob" } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ name: "Alice", user: "Bob", theme: "dark" });
  // Proxy が応答に付けた Cookie
  expect(res.headers.get("set-cookie")).toContain("seen=1");
});

test("Route Handler: POST の本文", async () => {
  const res = await requestRoute("/api/users/Alice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ to: "Alice", message: "hi" });
});

test("Proxy の matcher に入らないパスは Proxy を通らない", async () => {
  const res = await requestRoute("/users/Alice");
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("Proxy の redirect", async () => {
  const res = await requestRoute("/admin");
  expect(res.status).toBe(307);
  // 同じオリジンへの redirect は、Next.js が相対の Location にする
  expect(res.headers.get("location")).toBe("/users");
});

test("Proxy の rewrite（URL はそのままで、別のページを表示）", async () => {
  const res = await requestRoute("/admin", { cookies: { session: "Carol" } });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Profile <!-- -->Carol");
});

test("next.config の redirects / rewrites / headers", async () => {
  const redirected = await requestRoute("/members");
  expect(redirected.status).toBe(308);
  expect(redirected.headers.get("location")).toBe("/users");

  const rewritten = await requestRoute("/people/Dave");
  expect(rewritten.status).toBe(200);
  expect(await rewritten.text()).toContain("Profile <!-- -->Dave");

  expect((await requestRoute("/users/Eve")).headers.get("x-section")).toBe("users");
});
