// Client Graph の入口。テストからは `import(".../client-runtime.ts?client")` で読む
// oxlint-disable-next-line unicorn/prefer-export-from -- @types/react は export = なので export * as にできない
import * as React from "react";
import { renderToReadableStream } from "react-dom/server";
import {
  createFromReadableStream,
  encodeReply,
} from "react-server-dom-turbopack/client";

export const clientReact = React;

// Server Actions: Client → encodeReply → Server（handleAction はテスト側の Server Graph が登録する）
// → Flight { returnValue, root } → returnValue を返し、root で画面を更新する（RSC Refresh）
interface Runtime {
  callServer?: (id: string, args: unknown[]) => Promise<unknown>;
  handleAction?: (
    id: string,
    body: string | FormData
  ) => Promise<ReadableStream>;
}
const g = globalThis as typeof globalThis & {
  __turbopack_require__?: (id: string) => unknown;
  __proofyard?: Runtime;
};

// Client Reference のモジュール ID -> Client Graph で読んだ実装
const loaded = new Map<string, unknown>();
g.__turbopack_require__ = (id: string) => {
  if (!loaded.has(id)) {
    throw new Error(`[proofyard] client module not loaded: ${id}`);
  }
  return loaded.get(id);
};

// ponytail: 登録済みの Client Component を全部先に読む。Flight に出た参照だけ遅延で読む形にできる
export const loadClientModules = async (ids: Iterable<string>) => {
  for (const id of ids) {
    if (!loaded.has(id)) {
      // oxlint-disable-next-line no-await-in-loop -- 登録した順番に読む
      loaded.set(id, await import(`${id}?client`));
    }
  }
};

g.__proofyard ??= {};
const runtime: Runtime = g.__proofyard;
let lastConsumer: object | undefined;
let setRoot: ((tree: React.ReactNode) => void) | undefined;

runtime.callServer = async (id, args) => {
  if (!runtime.handleAction) {
    throw new Error("[proofyard] no server action handler is registered");
  }
  const body = await encodeReply(args);
  const stream = await runtime.handleAction(id, body);
  const { returnValue, root } = (await createFromReadableStream(stream, {
    callServer: runtime.callServer,
    serverConsumerManifest: lastConsumer,
  })) as { returnValue: unknown; root?: React.ReactNode };
  const set = setRoot;
  if (root !== undefined && set) {
    React.startTransition(() => set(root));
  }
  return returnValue;
};

// RSC Refresh で差し替えられるルート
// ponytail: ルートは1つだけ。Next.js の Router（PoC 5）ではセグメント単位のマージになる
const Root = ({ initial }: { initial: React.ReactNode }) => {
  const [tree, setTree] = React.useState(initial);
  // oxlint-disable-next-line react/globals -- RSC Refresh のためにルートの setState を外に出す
  setRoot = setTree;
  return tree;
};

export const withRoot = (tree: React.ReactNode) =>
  React.createElement(Root, { initial: tree });

export const decode = async (
  bytes: Uint8Array | ReadableStream,
  consumer: object
) => {
  lastConsumer = consumer;
  // oxlint-disable-next-line typescript/no-non-null-assertion -- 中身を渡した Response の body は null にならない
  return await createFromReadableStream(new Response(bytes).body!, {
    callServer: runtime.callServer,
    serverConsumerManifest: consumer,
  });
};

export const html = async (tree: React.ReactNode) => {
  const stream = await renderToReadableStream(tree);
  await stream.allReady;
  return new Response(stream).text();
};
