// Proofyard の公開 API
import type { NextHarness, PrerenderRouteResult, RequestRouteOptions } from "./next/preload";

export type { PrerenderRouteResult, RequestRouteOptions };

function harness(): NextHarness {
  const h = (globalThis as any)[Symbol.for("proofyard.next")] as NextHarness | undefined;
  if (!h) throw new Error('[proofyard] the Next.js preload is not loaded. Add `preload = ["proofyard/preload"]` to bunfig.toml');
  return h;
}

// URL へのリクエストを Next.js 本体のリクエスト処理に通し、HTTP の応答を返す（仕様 18.1 requestRoute）
export const requestRoute = (url: string, options?: RequestRouteOptions): Promise<Response> => harness().requestRoute(url, options);

// next build と同じ prerender で、Partial Prerendering の静的シェルを作る（仕様 12 章。cacheComponents が必要）
export const prerenderRoute = (url: string): Promise<PrerenderRouteResult> => harness().prerenderRoute(url);

// このテストで無効化されたキャッシュタグ（revalidateTag / updateTag / revalidatePath）
export const getInvalidatedTags = (): string[] => harness().invalidatedTags();

// after() に渡された処理（応答のあとに動く）が終わるまで待つ（仕様 16.2）
export const flushAfter = (): Promise<void> => harness().flushAfter();

// Server Components を RSC Mode で描画する（仕様 4.1 / 18.2）
export { renderRSC } from "./testing/render-rsc";
export type { ClientReference, ServerReference, RenderRSCResult, WaitOptions, RSCClientElement, RSCElement, RSCHostElement, RSCNode, TextMatcher } from "./testing/render-rsc";

// SSR Mode / Client Mode（仕様 4.2 / 4.3 / 14）
export { render } from "./testing/render";
export type { RenderOptions, RenderResult } from "./testing/render";
export type { ActionCall } from "./testing/actions";

// ルートを HTML にし、Client Mode では Next.js 本体のクライアントでハイドレーションする（仕様 18.3 / 18.4）
export { renderRoute } from "./testing/render-route";
export type { RenderRouteOptions, RenderRouteResult, RouteMetadata, RouteRouter } from "./testing/render-route";
