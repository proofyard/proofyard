// SSR 層の入口（src/next/preload.ts でバンドル）。Flight を SSR 用の React でデコードし、HTML にする
import { createElement, use } from "react";
import type { ReactNode } from "react";

export { renderToReadableStream } from "react-dom/server";
export { prerender } from "react-dom/static";
// oxlint-disable-next-line import/first -- モジュールの評価順（react-dom/server → react-dom/static → rsdw/client）を保つ
import { createFromReadableStream } from "react-server-dom-webpack/client";

export const decode = (
  stream: ReadableStream<Uint8Array>,
  moduleMap: Record<string, unknown>
) =>
  createFromReadableStream(stream, {
    serverConsumerManifest: {
      moduleLoading: null,
      moduleMap,
      serverModuleMap: null,
    },
  }) as PromiseLike<ReactNode>;

const FlightRoot = ({ response }: { response: PromiseLike<ReactNode> }) =>
  use(response as Promise<ReactNode>);
export const root = (response: PromiseLike<ReactNode>) =>
  createElement(FlightRoot, { response });
