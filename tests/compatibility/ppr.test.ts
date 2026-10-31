// 仕様 24.1: tests/ppr/fixture を本物の Next.js と比べる（bun run compat:ppr。next build を含むので遅い）
/* oxlint-disable no-loop-func -- reference は beforeAll で代入し、テストの中で読む */
import { afterAll, beforeAll, expect, test } from "bun:test";
import nodePath from "node:path";

import { prerenderRoute, requestRoute } from "proofyard";

import {
  comparableFlight,
  comparableHtml,
  comparableModule,
  referenceModulePaths,
  startReference,
} from "./reference";
import type { Reference } from "./reference";

let reference: Reference;
beforeAll(async () => {
  // /blocking は next build のエラー（同じエラーになることは tests/ppr）
  reference = await startReference(
    nodePath.join(import.meta.dir, "../ppr/fixture"),
    {
      exclude: ["app/blocking"],
    }
  );
}, 300_000);
afterAll(() => reference?.stop());

interface NextState {
  prefetchHints: unknown;
  prerenderManifest: {
    routes: Record<string, Record<string, unknown>>;
    dynamicRoutes: Record<string, Record<string, unknown>>;
    notFoundRoutes: unknown;
  };
}
const nextState = () =>
  (globalThis as unknown as Record<symbol, NextState>)[
    Symbol.for("proofyard.next")
  ] as NextState;

for (const path of [
  "/dashboard",
  "/about",
  "/posts/hello",
  "/products/1",
  "/private",
  "/library",
  "/links",
]) {
  test(`requestRoute ${path} は next start と同じ HTML`, async () => {
    const [ours, real] = await Promise.all([
      requestRoute(path),
      fetch(reference.url + path),
    ]);
    expect(ours.status).toBe(real.status);
    expect(comparableHtml(await ours.text())).toBe(
      comparableHtml(await real.text())
    );
  });
}

test("prefetch hints（server/prefetch-hints.json）は next build と同じ", async () => {
  const ours = nextState().prefetchHints;
  const real = await Bun.file(
    nodePath.join(reference.dir, ".next/server/prefetch-hints.json")
  ).json();
  // /blocking は next build が失敗するので写していない（Proofyard でも prerender できないので入らない）
  expect(ours).toEqual(real);
});

// 分類（routeType・response・compute）、experimentalBypassFor、allowHeader、initialStatus / initialHeaders はデプロイ先のアダプター向けで、next start は読まない
const pick = (entry: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(entry).filter(
      ([key]) =>
        !/^(?:routeType|response|compute|htmlSize|experimentalBypassFor|allowHeader|initialStatus|initialHeaders)$/u.test(
          key
        ) && entry[key] !== undefined
    )
  );
// Route Handler（/favicon.ico など）は Proofyard では prerender しない（リクエストのときに動かす）
const pages = (entries: Record<string, Record<string, unknown>>) =>
  Object.fromEntries(
    Object.entries(entries)
      .filter(([, { renderingMode }]) => renderingMode === "PARTIALLY_STATIC")
      .map(([path, entry]) => [path, pick(entry)])
  );
test("prerender-manifest.json は next build と同じ（next start が読む項目）", async () => {
  const ours = nextState().prerenderManifest;
  const real = await Bun.file(
    nodePath.join(reference.dir, ".next/prerender-manifest.json")
  ).json();
  expect(pages(ours.routes)).toEqual(pages(real.routes));
  expect(pages(ours.dynamicRoutes)).toEqual(pages(real.dynamicRoutes));
  expect(ours.notFoundRoutes).toEqual(real.notFoundRoutes);
});

// next build の .html は、動的な部分があれば閉じタグなし（続きは resume で流れる）
const withoutClosingTags = (html: string) =>
  comparableHtml(html).replace(/<\/body><\/html>$/u, "");
for (const path of [
  "/dashboard",
  "/about",
  "/posts/hello",
  "/products/[id]",
  "/private",
  "/library",
]) {
  test(`prerenderRoute ${path} は next build の静的シェル（.html）と同じ`, async () => {
    const result = await prerenderRoute(path);
    const html = await Bun.file(
      nodePath.join(reference.dir, ".next/server/app", `${path}.html`)
    ).text();
    expect(withoutClosingTags(result.shell)).toBe(withoutClosingTags(html));
  });
}

// generateStaticParams が返さない URL。next start はフォールバックのシェル（/products/1）か、
// フォールバックのシェルが空でもよいルートならその URL をリクエストのときに prerender したもの（/posts/other）を返す。
// /posts/other は、next start の静的シェルのデバッグが失敗する（500）ので、ふつうのリクエストの応答の先頭（シェル）と比べる
test("prerenderRoute /products/1 は next start の静的シェルと同じ", async () => {
  const result = await prerenderRoute("/products/1");
  const real = await fetch(`${reference.url}/products/1?__nextppronly=1`);
  expect(result.status).toBe(real.status);
  expect(comparableHtml(result.shell)).toBe(comparableHtml(await real.text()));
});
test("prerenderRoute /posts/other は next start の応答のシェルと同じ", async () => {
  const result = await prerenderRoute("/posts/other");
  const real = await fetch(`${reference.url}/posts/other`);
  expect(real.headers.get("x-nextjs-postponed")).toBe("1");
  const shell = comparableHtml(result.shell).replace(/<\/body><\/html>$/u, "");
  // 流れてきた中身（<div hidden id="S:n">）より前がシェル
  const realText = await real.text();
  const [page = ""] = realText.split('<div hidden id="S:');
  expect(comparableHtml(page).slice(0, shell.length)).toBe(shell);
});
test("prerenderRoute /posts/[slug]（空のフォールバックのシェル）は next start と同じ", async () => {
  const result = await prerenderRoute("/posts/[slug]");
  const real = await fetch(
    `${reference.url}/posts/[slug]?__nextppronly=fallback`
  );
  expect(result.status).toBe(real.status);
  expect(result.postponed).toBe(real.headers.get("x-nextjs-postponed") === "1");
  expect(result.shell).toBe(await real.text());
  expect(
    await Bun.file(
      nodePath.join(reference.dir, ".next/server/app/posts/[slug].html")
    ).text()
  ).toBe("");
});

// RSC のペイロード（クライアントのナビゲーション）を Flight の意味論で比べる（next-app.test.ts と同じ）。
// /about は静的なルートで、next start は build のときの RSC を返すので比べない
for (const path of ["/dashboard", "/posts/hello", "/products/1", "/private"]) {
  test(`RSC ${path} は next start と同じ Flight`, async () => {
    const ours = await requestRoute(`${path}?_rsc=`, { headers: { rsc: "1" } });
    const real = await fetch(`${reference.url}${path}?_rsc=`, {
      headers: { rsc: "1" },
      redirect: "manual",
    });
    expect(real.headers.get("x-nextjs-prerender")).toBeNull();
    expect(ours.status).toBe(real.status);
    const paths = referenceModulePaths(reference);
    const dirs = [
      nodePath.join(import.meta.dir, "../ppr/fixture"),
      reference.dir,
    ];
    expect(
      await comparableFlight(await ours.text(), (id) =>
        comparableModule(id, dirs)
      )
    ).toEqual(
      await comparableFlight(await real.text(), (id) =>
        comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)
      )
    );
  });
}

// Link の先読み（prefetch hints で静的なものを試すとき）。next start は build のときのセグメント（.segments）を返す。
// Proofyard はテストの中でそのページを最初にリクエストしたときに build と同じ結果を作り、そこから返す（README の違い）。
// ヘッダーはブラウザの Next.js のクライアントが送るもの
const {
  computeCacheBustingSearchParam,
  // oxlint-disable-next-line unicorn/prefer-module -- Next.js の内部の CJS をテストのときに読む
} = require("next/dist/shared/lib/router/utils/cache-busting-search-param");

const prefetchCases = [
  { name: "ルートの木（/_tree）", segment: "/_tree", stateTree: undefined },
  {
    name: "metadata だけ",
    segment: undefined,
    stateTree: encodeURIComponent(
      JSON.stringify(["", {}, null, "metadata-only"])
    ),
  },
];
for (const path of ["/dashboard", "/posts/hello"]) {
  for (const { name: caseName, segment, stateTree } of prefetchCases) {
    test(`先読み ${path} の${caseName}は next start と同じ`, async () => {
      const headers: Record<string, string> = {
        "next-router-prefetch": "1",
        rsc: "1",
        ...(segment && { "next-router-segment-prefetch": segment }),
        ...(stateTree && { "next-router-state-tree": stateTree }),
      };
      const url = `${path}?_rsc=${await computeCacheBustingSearchParam("1", segment, stateTree, undefined)}`;
      const ours = await requestRoute(url, { headers });
      const real = await fetch(reference.url + url, {
        headers,
        redirect: "manual",
      });
      expect(ours.status).toBe(real.status);
      for (const name of ["content-type", "x-nextjs-postponed"]) {
        expect(`${name}: ${ours.headers.get(name)}`).toBe(
          `${name}: ${real.headers.get(name)}`
        );
      }
      // 404（build のときのデータにないもの）は空の本文
      if (real.status !== 200) {
        expect(await ours.text()).toBe(await real.text());
        return;
      }
      const paths = referenceModulePaths(reference);
      const dirs = [
        nodePath.join(import.meta.dir, "../ppr/fixture"),
        reference.dir,
      ];
      expect(
        await comparableFlight(await ours.text(), (id) =>
          comparableModule(id, dirs)
        )
      ).toEqual(
        await comparableFlight(await real.text(), (id) =>
          comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)
        )
      );
    });
  }
}
