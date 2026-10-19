// PoC 2（仕様22章）: "use client" を Client Reference として扱い、SC → CC → SC → CC を通す。
// `bun test --preload ./tests/poc/poc2/plugin.ts tests/poc/poc2` で実行する（package.json の test:poc2）。
// このファイル自体は Client Graph（条件なしの react）で動く。
import { expect, test } from "bun:test";
import { join } from "node:path";
import { createFromReadableStream } from "react-server-dom-turbopack/client";
import { renderToReadableStream as renderHTML } from "react-dom/server";
import { RSC, clientModules } from "./plugin";

const fixtures = join(import.meta.dir, "fixtures");
const log: string[] = ((globalThis as any).__proofyardLog ??= []);

// Client Runtime 側: Client Reference のモジュール ID を Client Graph の実装に解決する
(globalThis as any).__turbopack_require__ = (id: string) => require(id);

const server = await import(join(import.meta.dir, "server.ts") + RSC);

function manifests() {
  const ids = [...clientModules.keys()];
  return {
    // Server 側（renderToReadableStream の第2引数）
    client: Object.fromEntries(ids.map((id) => [id, { id, chunks: [], name: "*" }])),
    // Client 側（createFromReadableStream の serverConsumerManifest）
    consumer: {
      moduleMap: Object.fromEntries(ids.map((id) => [id, { "*": { id, chunks: [], name: "*" } }])),
      serverModuleMap: null,
      moduleLoading: null,
    },
  };
}

async function decode(bytes: Uint8Array, consumer: object) {
  return Promise.resolve(createFromReadableStream(new Response(bytes).body!, { serverConsumerManifest: consumer }));
}

async function html(tree: any) {
  const stream = await renderHTML(tree);
  await stream.allReady;
  return new Response(stream).text();
}

test("SC → CC → SC → CC: Client Component は Server Graph で実行されず、Client 側で解決される", async () => {
  log.length = 0;
  // Server Graph で page.tsx を読む（theme.tsx は Client Reference になる）
  const page = join(fixtures, "page.tsx");
  await import(page + RSC);
  const m = manifests();
  const { bytes, errors } = await server.renderFlight(page + RSC, m.client);
  expect(errors).toEqual([]);

  // Flight 完了時点で Client Component の実装は一度も実行されていない
  expect(log).toEqual([]);

  // Flight には Client Reference の行が入っている
  const payload = new TextDecoder().decode(bytes);
  expect(payload).toContain(JSON.stringify(join(fixtures, "theme.tsx")).slice(1, -1));
  expect(payload).toContain('"ThemeProvider"');
  expect(payload).toContain('"Card"');

  // Client Graph でデコードし、react-dom/server で描画する
  const tree = await decode(bytes, m.consumer);
  const out = await html(tree);
  // ThemeProvider（CC）の Context が ServerContent（SC）をまたいで Card（CC）に届く
  expect(out).toContain("<main><p>Alice<!-- --> (<!-- -->dark<!-- -->)</p></main>");

  // 実装は Client Graph で1回だけ実行された
  expect(log).toEqual(["theme.tsx executed: useState=function"]);
});

test("Server Graph の React は react-server ビルド（Client 用 API がない）", async () => {
  const { serverReact } = await import(join(fixtures, "server-content.tsx") + RSC);
  expect(serverReact.useState).toBeUndefined();
  expect(serverReact.createContext).toBeUndefined();
  // Client Graph の React とは別インスタンス
  const clientReact = await import("react");
  expect(typeof clientReact.useState).toBe("function");
});

test("Client Component に関数を渡すとシリアライズエラーになる", async () => {
  const page = join(fixtures, "bad-page.tsx");
  await import(page + RSC);
  const m = manifests();
  const { bytes, errors } = await server.renderFlight(page + RSC, m.client);
  expect(String(errors[0])).toMatch(/Functions cannot be passed directly to Client Components/);
  // Client 側ではルートは解決し、エラーは描画時に表に出る
  const err = await decode(bytes, m.consumer).then(html).catch((e) => e);
  expect(err.message).toMatch(/Functions cannot be passed directly to Client Components/);
});

test("Server Graph で Client Component を直接呼ぶと失敗する", async () => {
  const { Card } = await import(join(fixtures, "theme.tsx") + RSC);
  expect(() => Card({ user: { name: "x" } })).toThrow(/cannot be called on the server/);
});
