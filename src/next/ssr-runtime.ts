// SSR 層の入口（src/next/preload.ts でバンドル）。Flight を SSR 用の React でデコードし、HTML にする
import { createElement, use, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import { renderToReadableStream } from "react-dom/server";
import { createFromReadableStream } from "react-server-dom-webpack/client";

export { prerender, renderToReadableStream };

export function decode(stream: ReadableStream<Uint8Array>, moduleMap: Record<string, unknown>) {
  return createFromReadableStream(stream, {
    serverConsumerManifest: { moduleMap, serverModuleMap: null, moduleLoading: null },
  }) as PromiseLike<ReactNode>;
}

function FlightRoot({ response }: { response: PromiseLike<ReactNode> }) {
  return use(response as Promise<ReactNode>);
}
export const root = (response: PromiseLike<ReactNode>) => createElement(FlightRoot, { response });
