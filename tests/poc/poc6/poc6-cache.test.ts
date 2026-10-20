// PoC 6: "use cache" を Next.js 本体の SWC 変換と実行時（cache-wrapper / キャッシュハンドラー）で動かす。
import { expect, test } from "bun:test";
import { getInvalidatedTags, requestRoute } from "proofyard";

// PROOFYARD_COMPARE_URL を指定すると、同じテストを本物の `next start` に HTTP で流す（Next.js 本体との比較）
const compareUrl = process.env.PROOFYARD_COMPARE_URL;
const send = (url: string, init: { method?: string } = {}): Promise<Response> =>
  compareUrl ? fetch(compareUrl + url, { method: init.method, redirect: "manual" }) : requestRoute(url, init);
const request = async (url: string, init?: { method?: string }) => {
  const res = await send(url, init);
  return { status: res.status, html: await res.text() };
};

// "use cache" の関数の実行回数（ページに出る "call N"）
async function product(id: string) {
  const res = await request(`/products/${id}`);
  expect(res.status).toBe(200);
  const m = res.html.replace(/<!-- -->/g, "").match(/product (\d+) call (\d+)/);
  if (!m) throw new Error(`no product in ${res.html}`);
  return Number(m[2]);
}
const revalidate = (tag: string, profile?: "max") =>
  request(`/api/revalidate?tag=${tag}${profile ? `&profile=${profile}` : ""}`, { method: "POST" });

test("同じ引数ならキャッシュに当たり、引数が違えば別のエントリ", async () => {
  const first = await product("1");
  expect(await product("1")).toBe(first);
  const other = await product("2");
  expect(other).toBe(first + 1);
  expect(await product("2")).toBe(other);
});

// 分離は Proofyard 側の機能なので本物のサーバーでは対象外
test.skipIf(!!compareUrl)("テストごとにキャッシュは分離される（前のテストのエントリは使われない）", async () => {
  const before = await product("2");
  // 前のテストで product 1 はキャッシュ済みだが、分離されているので再実行される
  expect(await product("1")).toBe(before + 1);
  expect(getInvalidatedTags()).toEqual([]);
});

test("revalidateTag(tag, { expire: 0 }) で次のリクエストから再実行", async () => {
  const first = await product("1");
  const other = await product("2");
  const res = await revalidate("product-1");
  expect(res.status).toBe(200);
  expect(JSON.parse(res.html)).toEqual({ revalidated: "product-1" });
  if (!compareUrl) expect(getInvalidatedTags()).toEqual(["product-1"]);
  const fresh = await product("1");
  expect(fresh).toBeGreaterThan(other);
  expect(await product("1")).toBe(fresh);
  // 別のタグのエントリは残る
  expect(await product("2")).toBe(other);
  expect(first).toBeLessThan(fresh);
});

test("revalidateTag(tag, 'max') は stale-while-revalidate（1 回目は古い値、裏で再実行）", async () => {
  const first = await product("1");
  await revalidate("product-1", "max");
  expect(await product("1")).toBe(first);
  expect(await product("1")).toBeGreaterThan(first);
});

// 本番のメモリのキャッシュハンドラーは revalidate を過ぎたエントリを捨てる（cache-handlers/default.ts）ので、その場で再実行
test("cacheLife の revalidate を過ぎたら再実行", async () => {
  const first = await product("1");
  expect(await product("1")).toBe(first);
  await Bun.sleep(1100);
  const fresh = await product("1");
  expect(fresh).toBeGreaterThan(first);
  expect(await product("1")).toBe(fresh);
});
