// Client Graph の入口。テストからは `import(".../client-runtime.ts?client")` で読む
import * as React from "react";
import { createFromReadableStream, encodeReply } from "react-server-dom-turbopack/client";
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

// Server Actions: Client → encodeReply → Server（handleAction はテスト側の Server Graph が登録する）
// → Flight { returnValue, root } → returnValue を返し、root で画面を更新する（RSC Refresh）
const runtime: {
  callServer?: (id: string, args: unknown[]) => Promise<unknown>;
  handleAction?: (id: string, body: string | FormData) => Promise<ReadableStream>;
} = ((globalThis as any).__proofyard ??= {});
let lastConsumer: object | undefined;
let setRoot: ((tree: React.ReactNode) => void) | undefined;

runtime.callServer = async (id, args) => {
  if (!runtime.handleAction) throw new Error("[proofyard] no server action handler is registered");
  const body = await encodeReply(args);
  const stream = await runtime.handleAction(id, body);
  const { returnValue, root } = (await createFromReadableStream(stream, {
    serverConsumerManifest: lastConsumer,
    callServer: runtime.callServer,
  })) as { returnValue: unknown; root?: React.ReactNode };
  if (root !== undefined && setRoot) React.startTransition(() => setRoot!(root));
  return returnValue;
};

// RSC Refresh で差し替えられるルート
// ponytail: ルートは1つだけ。Next.js の Router（PoC 5）ではセグメント単位のマージになる
function Root({ initial }: { initial: React.ReactNode }) {
  const [tree, set] = React.useState(initial);
  setRoot = set;
  return tree;
}

export function withRoot(tree: React.ReactNode) {
  return React.createElement(Root, { initial: tree });
}

export async function decode(bytes: Uint8Array | ReadableStream, consumer: object) {
  lastConsumer = consumer;
  return Promise.resolve(
    createFromReadableStream(new Response(bytes).body!, { serverConsumerManifest: consumer, callServer: runtime.callServer }),
  );
}

export async function html(tree: React.ReactNode) {
  const stream = await renderToReadableStream(tree);
  await stream.allReady;
  return new Response(stream).text();
}
