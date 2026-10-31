// PoC 2（仕様22章）: "use client" を Client Reference として扱い、SC → CC → SC → CC を通す。
// `bun run test:poc2` で実行する。
// このファイル自体は Server Graph（`react-server` 条件）で動く。
import { expect, mock, test } from "bun:test";
import nodePath from "node:path";

import * as React from "react";
import { renderToReadableStream } from "react-server-dom-turbopack/server";

import BadPage from "./fixtures/bad-page";
import Page from "./fixtures/page";
import { Card } from "./fixtures/theme";
import { CLIENT, clientModules } from "./plugin";

const fixtures = nodePath.join(import.meta.dir, "fixtures");
const g = globalThis as typeof globalThis & { __proofyardLog?: string[] };
g.__proofyardLog ??= [];
const log: string[] = g.__proofyardLog;

const client = await import(
  nodePath.join(import.meta.dir, "client-runtime.ts") + CLIENT
);

const manifests = () => {
  const ids = [...clientModules];
  return {
    // Server 側（renderToReadableStream の第2引数）
    client: Object.fromEntries(
      ids.map((id) => [id, { chunks: [], id, name: "*" }])
    ),
    // Client 側（createFromReadableStream の serverConsumerManifest）
    consumer: {
      moduleLoading: null,
      moduleMap: Object.fromEntries(
        ids.map((id) => [id, { "*": { chunks: [], id, name: "*" } }])
      ),
      serverModuleMap: null,
    },
  };
};

const renderFlight = async (node: React.ReactNode) => {
  const m = manifests();
  const errors: unknown[] = [];
  const stream = renderToReadableStream(node, m.client, {
    onError: (e: unknown) => {
      errors.push(e);
    },
  });
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { bytes, consumer: m.consumer, errors };
};

// Server -> Flight -> Client -> HTML
const renderHTML = async (node: React.ReactNode) => {
  const { bytes, errors, consumer } = await renderFlight(node);
  await client.loadClientModules(clientModules);
  return {
    errors,
    html: await client.html(await client.decode(bytes, consumer)),
  };
};

test("SC → CC → SC → CC: Client Component は Server Graph で実行されず、Client 側で解決される", async () => {
  log.length = 0;
  const { bytes, errors, consumer } = await renderFlight(<Page />);
  expect(errors).toEqual([]);

  // Flight 完了時点で Client Component の実装は一度も実行されていない
  expect(log).toEqual([]);

  // Flight には Client Reference の行が入っている
  const payload = new TextDecoder().decode(bytes);
  expect(payload).toContain(nodePath.join(fixtures, "theme.tsx"));
  expect(payload).toContain('"ThemeProvider"');
  expect(payload).toContain('"Card"');

  // Client Graph でデコードし、react-dom/server で描画する
  await client.loadClientModules(clientModules);
  const html = await client.html(await client.decode(bytes, consumer));
  // ThemeProvider（CC）の Context が ServerContent（SC）をまたいで Card（CC）に届く
  expect(html).toContain(
    "<main><p>Alice<!-- --> (<!-- -->dark<!-- -->)</p></main>"
  );

  // 実装は Client Graph で1回だけ実行された
  expect(log).toEqual(["theme.tsx executed: useState=function"]);
});

test("Server Graph と Client Graph の React は別インスタンス", () => {
  // react-server ビルド
  expect((React as unknown as { useState?: unknown }).useState).toBeUndefined();
  expect(typeof client.clientReact.useState).toBe("function");
});

test("Client Component に関数を渡すとシリアライズエラーになる", async () => {
  const { bytes, errors, consumer } = await renderFlight(<BadPage />);
  expect(String(errors[0])).toMatch(
    /Functions cannot be passed directly to Client Components/u
  );
  // Client 側ではルートは解決し、エラーは描画時に表に出る
  await client.loadClientModules(clientModules);
  const err = await client
    .decode(bytes, consumer)
    .then(client.html)
    .catch((error: Error) => error);
  expect(err.message).toMatch(
    /Functions cannot be passed directly to Client Components/u
  );
});

test("Server Graph で Client Component を直接呼ぶと失敗する", () => {
  expect(() => Card({ user: { name: "x" } })).toThrow(
    /cannot be called on the server/u
  );
});

// mock.module はファイル全体に効くので最後に置く
test("bun:test の mock.module が Server Component のデータ取得に効く", async () => {
  mock.module(nodePath.join(fixtures, "data.ts"), () => ({
    getUser: () => Promise.resolve({ name: "Mocked" }),
  }));
  const { html, errors } = await renderHTML(<Page />);
  expect(errors).toEqual([]);
  expect(html).toContain("<p>Mocked<!-- --> (<!-- -->dark<!-- -->)</p>");
});
