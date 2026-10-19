// Client Graph の入口。テストからは `import(".../client-runtime.ts?client")` で読む
import * as React from "react";
import { createFromReadableStream } from "react-server-dom-turbopack/client";
import { renderToReadableStream } from "react-dom/server";

export const clientReact = React;

// Client Reference のモジュール ID -> Client Graph で読んだ実装
const loaded = new Map<string, unknown>();
(globalThis as any).__turbopack_require__ = (id: string) => {
  if (!loaded.has(id)) throw new Error(`[proofyard] client module not loaded: ${id}`);
  return loaded.get(id);
};

// ponytail: 登録済みの Client Component を全部先に読む。Flight に出た参照だけ遅延で読む形にできる
export async function loadClientModules(ids: Iterable<string>) {
  for (const id of ids) if (!loaded.has(id)) loaded.set(id, await import(id + "?client"));
}

export async function decode(bytes: Uint8Array, consumer: object) {
  return Promise.resolve(createFromReadableStream(new Response(bytes).body!, { serverConsumerManifest: consumer }));
}

export async function html(tree: React.ReactNode) {
  const stream = await renderToReadableStream(tree);
  await stream.allReady;
  return new Response(stream).text();
}
