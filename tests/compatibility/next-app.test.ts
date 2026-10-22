// 仕様 24.1: tests/fixtures/next-app を本物の Next.js と比べる（bun run compat:next-app。next build を含むので遅い）
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { requestRoute } from "proofyard";
import { comparableHtml, startReference, type Reference } from "./reference";

let reference: Reference;
beforeAll(async () => {
  reference = await startReference(join(import.meta.dir, "../fixtures/next-app"), {
    // Proofyard では Fail Closed（node_modules の "use cache"）と、中身が偽物のフォント（next build が失敗する）
    exclude: ["app/third-party/cached", "app/fonts"],
  });
}, 300_000);
afterAll(() => reference?.stop());

// prerendered: next start は build のときに描画した HTML を返し、requestRoute は毎回リクエストのときに描画する（docs/handoff.md）。
// そのために HTML が違うもの（ステータスとヘッダーだけ比べる）
type Case = { path: string; cookies?: Record<string, string>; headers?: Record<string, string>; prerendered?: string };
const cases: Case[] = [
  { path: "/" },
  { path: "/users" },
  { path: "/users/Alice" },
  { path: "/members" },
  { path: "/people/Alice" },
  { path: "/admin" },
  { path: "/admin", cookies: { session: "Bob" } },
  { path: "/api/users/Alice", cookies: { session: "Ann" } },
  { path: "/dashboard", prerendered: "useSearchParams() の Suspense は、build のときは fallback（CSR に任せる）" },
  { path: "/dashboard/settings", prerendered: "useSearchParams() の Suspense は、build のときは fallback（CSR に任せる）" },
  { path: "/dashboard/teams/core" },
  { path: "/gallery" },
  { path: "/gallery/photo/1" },
  { path: "/meta/hello" },
  { path: "/stream" },
  { path: "/slow" },
  { path: "/lazy" },
  { path: "/compat" },
  { path: "/concurrent" },
  { path: "/styled" },
  { path: "/og" },
  { path: "/state" },
  { path: "/third-party" },
  { path: "/third-party/server" },
  { path: "/third-party/next?q=x", cookies: { locale: "ja" } },
  { path: "/third-party/next", cookies: { locale: "fr" } },
  { path: "/does-not-exist", prerendered: "_not-found は build のときの HTML で、<title> の並びが違う（notFound() をリクエストのときに呼ぶ /third-party/next は同じ）" },
  { path: "/robots.txt" },
  { path: "/sitemap.xml" },
];

// Bun の Response.json() は charset を付ける（Node.js は付けない）。アプリのコードは Bun で動く
const contentType = (value: string | null) => value?.replace(/^application\/json;charset=utf-8$/, "application/json");

for (const { path, cookies, headers, prerendered } of cases)
  test(`requestRoute ${path}${cookies ? ` ${JSON.stringify(cookies)}` : ""} は next start と同じ`, async () => {
    const cookie = cookies && Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const [ours, real] = await Promise.all([
      requestRoute(path, { cookies, headers }),
      fetch(reference.url + path, { redirect: "manual", headers: { ...headers, ...(cookie && { cookie }) } }),
    ]);
    expect(ours.status).toBe(real.status);
    expect(ours.headers.get("location")?.replace(/^https?:\/\/[^/]+/, "")).toBe(real.headers.get("location")?.replace(/^https?:\/\/[^/]+/, "") ?? undefined);
    expect(contentType(ours.headers.get("content-type"))).toBe(contentType(real.headers.get("content-type")));
    for (const name of ["x-section", "set-cookie"]) expect(`${name}: ${ours.headers.get(name)}`).toBe(`${name}: ${real.headers.get(name)}`);
    if (!prerendered) expect(comparableHtml(await ours.text())).toBe(comparableHtml(await real.text()));
  });

// JS なしのフォームの送信（progressive enhancement）。Action の id はビルドごとに違うので、それぞれの HTML から取る
for (const [index, form] of ["addUser（revalidatePath）", "addAndOpen（redirect）"].entries())
  test(`Server Action ${form} のフォームの送信は next start と同じ`, async () => {
    const actionId = async (response: Response | Promise<Response>) => [...(await (await response).text()).matchAll(/name="(\$ACTION_ID_[0-9a-f]+)"/g)][index]![1]!;
    const post = (id: string) => {
      const body = new FormData();
      body.set(id, "");
      body.set("name", `Carol${index}`);
      return body;
    };
    const ours = await requestRoute("/users", { method: "POST", body: post(await actionId(requestRoute("/users"))) });
    const real = await fetch(`${reference.url}/users`, { method: "POST", redirect: "manual", body: post(await actionId(fetch(`${reference.url}/users`))) });
    expect(ours.status).toBe(real.status);
    expect(ours.headers.get("location")).toBe(real.headers.get("location"));
    expect(comparableHtml(await ours.text())).toBe(comparableHtml(await real.text()));
  });
