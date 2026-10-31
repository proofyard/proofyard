// ブラウザ層（Client Mode）の入口。Next.js のブラウザ用 React と一緒にバンドルされる（src/next/preload.ts）。
// react / react-dom / Testing Library はここから読むこと（rsc 層の React と混ぜない）
import { createElement, startTransition, use, useState } from "react";
import type { ReactNode } from "react";
import { createFromReadableStream } from "react-server-dom-webpack/client";

export { act } from "react";
export { encodeReply } from "react-server-dom-webpack/client";
// pure: 自動の afterEach / beforeAll を登録しない版（テストの途中で読み込むため。後片付けはプリロードの afterEach）
export {
  render,
  cleanup,
  within,
  screen,
  waitFor,
} from "@testing-library/react/pure";
export { default as userEvent } from "@testing-library/user-event";

export type CallServer = (id: string, args: unknown[]) => Promise<unknown>;

// Flight をブラウザ用の React でデコードする（Client Reference はブラウザ層の実装を読む。Server Action は callServer を呼ぶ）
export const decode = (
  stream: ReadableStream<Uint8Array>,
  callServer?: CallServer
) => createFromReadableStream(stream, { callServer }) as PromiseLike<unknown>;

// デコード結果を描画するルート。Server Action の後は、描画し直した Server Components のツリーに差し替える（RSC Refresh）
const FlightRoot = ({
  initial,
  bind,
}: {
  initial: PromiseLike<ReactNode>;
  bind: (set: (tree: PromiseLike<ReactNode>) => void) => void;
}) => {
  const [tree, setTree] = useState(initial);
  bind(setTree);
  return use(tree as Promise<ReactNode>);
};
export const root = (initial: PromiseLike<ReactNode>) => {
  let setTree: ((tree: PromiseLike<ReactNode>) => void) | undefined;
  return {
    element: createElement(FlightRoot, {
      bind: (set) => (setTree = set),
      initial,
    }),
    refresh: (tree: ReactNode) =>
      startTransition(() => setTree?.(Promise.resolve(tree))),
  };
};
