// ブラウザ層（Client Mode）の入口。Next.js のブラウザ用 React と一緒にバンドルされる（src/next/preload.ts）。
// react / react-dom / Testing Library はここから読むこと（rsc 層の React と混ぜない）
import { createElement, use, type ReactNode } from "react";
import { createFromReadableStream } from "react-server-dom-webpack/client";

export { act } from "react";
// pure: 自動の afterEach / beforeAll を登録しない版（テストの途中で読み込むため。後片付けはプリロードの afterEach）
export { render, cleanup, within, screen, waitFor } from "@testing-library/react/pure";
export { default as userEvent } from "@testing-library/user-event";

// Flight をブラウザ用の React でデコードする（Client Reference はブラウザ層の実装を読む）
export const decode = (stream: ReadableStream<Uint8Array>) => createFromReadableStream(stream) as PromiseLike<ReactNode>;

// デコード結果をそのまま描画するルート（シェルが届くまでは React 自身がサスペンドする）
function FlightRoot({ response }: { response: PromiseLike<ReactNode> }) {
  return use(response as Promise<ReactNode>);
}
export const root = (response: PromiseLike<ReactNode>) => createElement(FlightRoot, { response });
