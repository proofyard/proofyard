// 仕様 24.1: tests/ppr/fixture を本物の Next.js と比べる（bun run compat:ppr。next build を含むので遅い）
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { prerenderRoute, requestRoute } from "proofyard";
import { comparableFlight, comparableHtml, comparableModule, referenceModulePaths, startReference, type Reference } from "./reference";

let reference: Reference;
beforeAll(async () => {
  // /blocking は next build のエラー（同じエラーになることは tests/ppr）
  reference = await startReference(join(import.meta.dir, "../ppr/fixture"), { exclude: ["app/blocking"] });
}, 300_000);
afterAll(() => reference?.stop());

for (const path of ["/dashboard", "/about", "/posts/hello", "/products/1", "/private", "/library", "/links"])
  test(`requestRoute ${path} は next start と同じ HTML`, async () => {
    const [ours, real] = await Promise.all([requestRoute(path), fetch(reference.url + path)]);
    expect(ours.status).toBe(real.status);
    expect(comparableHtml(await ours.text())).toBe(comparableHtml(await real.text()));
  });

test("prefetch hints（server/prefetch-hints.json）は next build と同じ", async () => {
  const ours = (globalThis as any)[Symbol.for("proofyard.next")].prefetchHints;
  const real = await Bun.file(join(reference.dir, ".next/server/prefetch-hints.json")).json();
  // /blocking は next build が失敗するので写していない（Proofyard でも prerender できないので入らない）
  expect(ours).toEqual(real);
});

for (const path of ["/dashboard", "/about", "/posts/hello", "/products/[id]", "/private", "/library"])
  test(`prerenderRoute ${path} は next build の静的シェル（.html）と同じ`, async () => {
    const result = await prerenderRoute(path);
    const html = await Bun.file(join(reference.dir, ".next/server/app", `${path}.html`)).text();
    // next build の .html は、動的な部分があれば閉じタグなし（続きは resume で流れる）
    const withoutClosingTags = (html: string) => comparableHtml(html).replace(/<\/body><\/html>$/, "");
    expect(withoutClosingTags(result.shell)).toBe(withoutClosingTags(html));
  });

// RSC のペイロード（クライアントのナビゲーション）を Flight の意味論で比べる（next-app.test.ts と同じ）。
// /about は静的なルートで、next start は build のときの RSC を返すので比べない
for (const path of ["/dashboard", "/posts/hello", "/products/1", "/private"])
  test(`RSC ${path} は next start と同じ Flight`, async () => {
    const ours = await requestRoute(`${path}?_rsc=`, { headers: { rsc: "1" } });
    const real = await fetch(`${reference.url}${path}?_rsc=`, { redirect: "manual", headers: { rsc: "1" } });
    expect(real.headers.get("x-nextjs-prerender")).toBeNull();
    expect(ours.status).toBe(real.status);
    const paths = referenceModulePaths(reference);
    const dirs = [join(import.meta.dir, "../ppr/fixture"), reference.dir];
    expect(await comparableFlight(await ours.text(), (id) => comparableModule(id, dirs))).toEqual(
      await comparableFlight(await real.text(), (id) => comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)),
    );
  });

// Link の先読み（prefetch hints で静的なものを試すとき）。next start は build のときのセグメント（.segments）を返し、
// Proofyard はリクエストのときに描く。ヘッダーはブラウザの Next.js のクライアントが送るもの
const { computeCacheBustingSearchParam } = require("next/dist/shared/lib/router/utils/cache-busting-search-param");
const prefetchCases = [
  { name: "ルートの木（/_tree）", segment: "/_tree", stateTree: undefined },
  { name: "metadata だけ", segment: undefined, stateTree: encodeURIComponent(JSON.stringify(["", {}, null, "metadata-only"])) },
];
// 未対応: next start はこれらをビルド時に作った segment データ（prerender-manifest と .segments）から返すが、
// proofyard はリクエストごとに描画するので応答が違う。一致したら test.failing が落ちて知らせる。
for (const path of ["/dashboard", "/posts/hello"])
  for (const { name, segment, stateTree } of prefetchCases)
    test.failing(`先読み ${path} の${name}は next start と同じ`, async () => {
      const headers: Record<string, string> = { rsc: "1", "next-router-prefetch": "1", ...(segment && { "next-router-segment-prefetch": segment }), ...(stateTree && { "next-router-state-tree": stateTree }) };
      const url = `${path}?_rsc=${await computeCacheBustingSearchParam("1", segment, stateTree, undefined)}`;
      const ours = await requestRoute(url, { headers });
      const real = await fetch(reference.url + url, { redirect: "manual", headers });
      expect(ours.status).toBe(real.status);
      for (const name of ["content-type", "x-nextjs-postponed"]) expect(`${name}: ${ours.headers.get(name)}`).toBe(`${name}: ${real.headers.get(name)}`);
      const paths = referenceModulePaths(reference);
      const dirs = [join(import.meta.dir, "../ppr/fixture"), reference.dir];
      expect(await comparableFlight(await ours.text(), (id) => comparableModule(id, dirs))).toEqual(
        await comparableFlight(await real.text(), (id) => comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)),
      );
    });
