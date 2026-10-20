// Proofyard の公開 API
import type { NextHarness, RequestRouteOptions } from "./next/preload";

export type { RequestRouteOptions };

function harness(): NextHarness {
  const h = (globalThis as any)[Symbol.for("proofyard.next")] as NextHarness | undefined;
  if (!h) throw new Error('[proofyard] the Next.js preload is not loaded. Add `preload = ["proofyard/preload"]` to bunfig.toml');
  return h;
}

// URL へのリクエストを Next.js 本体のリクエスト処理に通し、HTTP の応答を返す（仕様 18.1 requestRoute）
export const requestRoute = (url: string, options?: RequestRouteOptions): Promise<Response> => harness().requestRoute(url, options);

// このテストで無効化されたキャッシュタグ（revalidateTag / updateTag / revalidatePath）
export const getInvalidatedTags = (): string[] => harness().invalidatedTags();

// Server Components を RSC Mode で描画する（仕様 4.1 / 18.2）
export { renderRSC } from "./testing/render-rsc";
export type { ClientReference, ServerReference, RenderRSCResult, WaitOptions, RSCClientElement, RSCElement, RSCHostElement, RSCNode, TextMatcher } from "./testing/render-rsc";

// SSR Mode / Client Mode（仕様 4.2 / 4.3 / 14）
export { render } from "./testing/render";
export type { RenderOptions, RenderResult } from "./testing/render";
