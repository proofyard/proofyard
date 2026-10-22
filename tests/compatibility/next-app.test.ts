// 仕様 24.1: tests/fixtures/next-app を本物の Next.js と比べる（bun run compat:next-app。next build を含むので遅い）
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { requestRoute } from "proofyard";
import { comparableFlight, comparableHtml, comparableModule, referenceModulePaths, startReference, type Reference } from "./reference";

let reference: Reference;
beforeAll(async () => {
  reference = await startReference(join(import.meta.dir, "../fixtures/next-app"), {
    // 中身が偽物のフォント（next build が失敗する）
    exclude: ["app/fonts"],
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
  { path: "/query" },
  { path: "/third-party" },
  { path: "/third-party/server" },
  { path: "/third-party/actions" },
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

// RSC のペイロード（クライアントのナビゲーションのリクエスト）を Flight の意味論で比べる。
// 比べるのはリクエストのときに描くルートだけ: next start は静的なルートに build のときの RSC（最初の HTML 用の形。`P`・`G` などがある）を返す
const flightCases: Pick<Case, "path" | "cookies">[] = [
  { path: "/users/Alice" },
  { path: "/people/Alice" },
  { path: "/admin", cookies: { session: "Bob" } },
  { path: "/dashboard/teams/core" },
  { path: "/gallery/photo/1" },
  { path: "/meta/hello" },
  { path: "/third-party/next?q=x", cookies: { locale: "ja" } },
  { path: "/third-party/next", cookies: { locale: "fr" } },
  { path: "/third-party/actions" },
];
const fixture = join(import.meta.dir, "../fixtures/next-app");
for (const { path, cookies } of flightCases)
  test(`RSC ${path}${cookies ? ` ${JSON.stringify(cookies)}` : ""} は next start と同じ Flight`, async () => {
    // 送るヘッダーがないときの _rsc は空（Next.js の computeCacheBustingSearchParam）
    const url = `${path}${path.includes("?") ? "&" : "?"}_rsc=`;
    const cookie = cookies && Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const ours = await requestRoute(url, { cookies, headers: { rsc: "1" } });
    const real = await fetch(reference.url + url, { redirect: "manual", headers: { rsc: "1", ...(cookie && { cookie }) } });
    expect(real.headers.get("x-nextjs-prerender")).toBeNull();
    expect(ours.status).toBe(real.status);
    expect(ours.headers.get("content-type")).toBe(real.headers.get("content-type"));
    const [oursText, realText] = [await ours.text(), await real.text()];
    const paths = (modulePaths ??= referenceModulePaths(reference));
    const dirs = [fixture, reference.dir];
    expect(await comparableFlight(oursText, (id) => comparableModule(id, dirs))).toEqual(
      await comparableFlight(realText, (id) => comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)),
    );
  });
let modulePaths: Map<string, string> | undefined;

// JS ありのクライアントからの Server Action（Next-Action ヘッダーと encodeReply の本文）の応答を Flight の意味論で比べる
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js");
const actionCases = [
  { form: "addUser（revalidatePath）", page: "/users", index: 0, field: "name", value: "Dave0" },
  { form: "addAndOpen（redirect）", page: "/users", index: 1, field: "name", value: "Dave1" },
  { form: "node_modules の addEntry", page: "/third-party/actions", index: 0, field: "entry", value: "compat" },
];
for (const { form, page, index, field, value } of actionCases)
  test(`Server Action ${form} の fetch の応答は next start と同じ Flight`, async () => {
    const actionId = async (response: Response | Promise<Response>) => [...(await (await response).text()).matchAll(/name="\$ACTION_ID_([0-9a-f]+)"/g)][index]![1]!;
    const request = async (id: string) => {
      const formData = new FormData();
      formData.set(field, value);
      // Bun の FormData には toJSON があり、JSON.stringify が React の FormData の判定より先に普通のオブジェクトにする
      Object.defineProperty(formData, "toJSON", { value: undefined });
      return { method: "POST", headers: { "next-action": id, accept: "text/x-component" }, body: await encodeReply([formData]) };
    };
    const ours = await requestRoute(page, await request(await actionId(requestRoute(page))));
    const real = await fetch(reference.url + page, { redirect: "manual", ...(await request(await actionId(fetch(reference.url + page)))) });
    expect(real.status).toBe(200);
    if (form.includes("redirect")) expect(real.headers.get("x-action-redirect")).toStartWith("/users/Dave1");
    expect(ours.status).toBe(real.status);
    for (const name of ["content-type", "x-action-redirect", "x-action-revalidated"]) expect(`${name}: ${ours.headers.get(name)}`).toBe(`${name}: ${real.headers.get(name)}`);
    const paths = (modulePaths ??= referenceModulePaths(reference));
    const dirs = [fixture, reference.dir];
    expect(await comparableFlight(await ours.text(), (id) => comparableModule(id, dirs))).toEqual(
      await comparableFlight(await real.text(), (id) => comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)),
    );
  });

// ソフトナビゲーション（Next.js のクライアントが今の木を Next-Router-State-Tree で送る）。共通のレイアウトから下だけが返る。
// Next-Url はインターセプトの元の URL
const { computeCacheBustingSearchParam } = require("next/dist/shared/lib/router/utils/cache-busting-search-param");
const navigationCases = [
  { from: "/dashboard/settings", to: "/dashboard/teams/core", tree: ["", { children: ["dashboard", { children: ["settings", { children: ["__PAGE__", {}] }] }] }] },
  { from: "/gallery", to: "/gallery/photo/1", tree: ["", { children: ["gallery", { children: ["__PAGE__", {}], modal: ["__DEFAULT__", {}] }] }], nextUrl: "/gallery" },
  { from: "/gallery", to: "/gallery/photo/1", tree: ["", { children: ["gallery", { children: ["__PAGE__", {}], modal: ["__DEFAULT__", {}] }] }] },
];
for (const { from, to, tree, nextUrl } of navigationCases)
  test(`RSC ${from} → ${to}${nextUrl ? `（Next-Url: ${nextUrl}）` : ""} は next start と同じ Flight`, async () => {
    const stateTree = encodeURIComponent(JSON.stringify(tree));
    const headers: Record<string, string> = { rsc: "1", "next-router-state-tree": stateTree, ...(nextUrl && { "next-url": nextUrl }) };
    const url = `${to}?_rsc=${await computeCacheBustingSearchParam(undefined, undefined, stateTree, nextUrl)}`;
    const ours = await requestRoute(url, { headers });
    const real = await fetch(reference.url + url, { redirect: "manual", headers });
    expect(real.status).toBe(200);
    expect(ours.status).toBe(real.status);
    const paths = (modulePaths ??= referenceModulePaths(reference));
    const dirs = [fixture, reference.dir];
    expect(await comparableFlight(await ours.text(), (id) => comparableModule(id, dirs))).toEqual(
      await comparableFlight(await real.text(), (id) => comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)),
    );
  });
