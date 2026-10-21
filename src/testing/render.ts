// SSR Mode / Client Mode（仕様 4.2 / 4.3 / 14）。Server Components を Flight にし、
//   ssr:    SSR 層の React でデコードして HTML にし、turbo-dom に入れる（Effect は動かない）
//   client: ブラウザ層の React でデコードして createRoot で描画する（hydrate: true なら SSR の HTML を hydrateRoot）
// クエリは Testing Library（ブラウザ層のもの）。
import type { NextHarness } from "../next/preload";
import { installDom } from "../dom/environment";
import { renderFlight } from "./render-rsc";
import { runAction, type ActionCall } from "./actions";

type BrowserRuntime = typeof import("../client/runtime");
type Queries = ReturnType<BrowserRuntime["within"]>;

export type RenderOptions = {
  mode?: "ssr" | "client";
  // Client Mode で、SSR の HTML を hydrateRoot する
  hydrate?: boolean;
};
export type RenderResult = Queries & {
  container: HTMLElement;
  // SSR の HTML（ssr、または hydrate のとき）
  html?: string;
  // Client Mode のユーザー操作（@testing-library/user-event）
  user?: ReturnType<BrowserRuntime["userEvent"]["setup"]>;
  // hydrateRoot の onRecoverableError に届いたエラー（Hydration Mismatch など）
  recoverableErrors: unknown[];
  // Client Mode で呼ばれた Server Actions
  actions: {
    // 関数名、または import した Server Action で絞る
    getCalls(action?: string | Function): ActionCall[];
  };
  unmount(): void;
};

function harness(): NextHarness {
  const h = (globalThis as any)[Symbol.for("proofyard.next")] as NextHarness | undefined;
  if (!h) throw new Error('[proofyard] the Next.js preload is not loaded. Add `preload = ["proofyard/preload"]` to bunfig.toml');
  return h;
}

// DOM は使うときに入れる（rsc / ssr 層のコードに window を見せないため、プリロードでは入れない）
function ensureDom() {
  installDom();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
}

const containers = new Set<HTMLElement>();
let browserRuntime: BrowserRuntime | undefined;

// テストごとの後片付け（プリロードの afterEach から呼ばれる）
(globalThis as any)[Symbol.for("proofyard.cleanup")] = () => {
  browserRuntime?.cleanup();
  for (const container of containers) container.remove();
  containers.clear();
};

async function ssrHtml(stream: ReadableStream<Uint8Array>, serverError: (error: unknown) => unknown) {
  const h = harness();
  const ssr = h.ssrRuntime();
  // SSR 層の Flight クライアントは globalThis.__next_require__ で Client Component を読む
  (globalThis as any).__next_require__ = (id: string) => (globalThis as any).__proofyardNextRequire(id);
  try {
    const { prelude } = await ssr.prerender(ssr.root(ssr.decode(stream, h.ssrModuleMap())));
    return await new Response(prelude).text();
  } catch (error) {
    throw serverError(error);
  }
}

const actionsOf = (calls: ActionCall[]): RenderResult["actions"] => ({
  getCalls: (action) =>
    action === undefined
      ? [...calls]
      : calls.filter((call) => (typeof action === "string" ? call.name === action : call.id === (action as { $$id?: string }).$$id)),
});

export async function render(ui: unknown, { mode = "client", hydrate = false }: RenderOptions = {}): Promise<RenderResult> {
  ensureDom();
  // ブラウザ層を先に用意してから描画を始める（Flight のストリームはすぐに読み始める）
  const browser = (browserRuntime ??= await harness().loadBrowser());
  const { stream, serverError } = renderFlight(ui);
  const recoverableErrors: unknown[] = [];

  if (mode === "ssr") {
    if (hydrate) throw new Error('[proofyard] hydrate requires mode: "client"');
    const html = await ssrHtml(stream, serverError);
    const container = document.body.appendChild(document.createElement("div"));
    containers.add(container);
    container.innerHTML = html;
    return { ...browser.within(container), container, html, recoverableErrors, actions: actionsOf([]), unmount: () => container.remove() };
  }

  let html: string | undefined;
  let clientStream = stream;
  let container: HTMLElement | undefined;
  if (hydrate) {
    // 同じ Flight を SSR とブラウザの両方に流す
    const [forSsr, forClient] = stream.tee();
    clientStream = forClient;
    html = await ssrHtml(forSsr, serverError);
    container = document.body.appendChild(document.createElement("div"));
    containers.add(container);
    container.innerHTML = html;
  }
  // Server Actions: 引数を encodeReply → サーバーで decodeReply して実行 → 戻り値と描画し直した Server Components を Flight で返す
  const calls: ActionCall[] = [];
  const callServer = async (id: string, args: unknown[]): Promise<unknown> => {
    const body = await browser.encodeReply(args);
    const { result } = await runAction(id, body as string | FormData, calls);
    const { stream, serverError: actionError } = renderFlight({ result, tree: ui });
    try {
      const { result: returned, tree } = (await browser.decode(stream, callServer)) as { result: PromiseLike<unknown>; tree: unknown };
      flightRoot.refresh(tree as any);
      return await returned;
    } catch (error) {
      throw actionError(error);
    }
  };
  // Client Component から import した Server Action（src/client/app-call-server.ts）もこれを使う
  (globalThis as any)[Symbol.for("proofyard.callServer")] = callServer;
  const response = browser.decode(clientStream, callServer);
  try {
    // シェルが届いてから描画する
    await response;
  } catch (error) {
    throw serverError(error);
  }
  const flightRoot = browser.root(response as PromiseLike<any>);
  // Flight の続きのチャンクでサスペンドするので、非同期の act で描画する
  let utils: ReturnType<BrowserRuntime["render"]> | undefined;
  await browser.act(async () => {
    utils = browser.render(flightRoot.element as any, {
      container,
      hydrate,
      onRecoverableError: (error: unknown) => void recoverableErrors.push(error),
    } as any);
  });
  const rendered = utils!;
  containers.add(rendered.container);
  // クエリは Testing Library と同じく document.body 全体（Portal で外に描画されたものも見つかる）
  return {
    ...browser.within(rendered.baseElement),
    container: rendered.container,
    html,
    // 既定の document は user-event の読み込み時のもの。いまの document を渡す
    user: browser.userEvent.setup({ document }),
    recoverableErrors,
    actions: actionsOf(calls),
    unmount: rendered.unmount,
  } as unknown as RenderResult;
}
