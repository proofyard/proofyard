// SSR Mode / Client Mode（仕様 4.2 / 4.3 / 14）。Server Components を Flight にし、
//   ssr:    SSR 層の React でデコードして HTML にし、turbo-dom に入れる（Effect は動かない）
//   client: ブラウザ層の React でデコードして createRoot で描画する（hydrate: true なら SSR の HTML を hydrateRoot）
// クエリは Testing Library（ブラウザ層のもの）。
import type { NextHarness } from "../next/preload";
import { installDom } from "../dom/environment";
import { renderFlight } from "./render-rsc";

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
  unmount(): void;
};

function harness(): NextHarness {
  const h = (globalThis as any)[Symbol.for("proofyard.next")] as NextHarness | undefined;
  if (!h) throw new Error('[proofyard] the Next.js preload is not loaded. Add `preload = ["proofyard/preload"]` to bunfig.toml');
  return h;
}

// DOM は使うときに入れる（rsc / ssr 層のコードに window を見せないため、プリロードでは入れない）
function ensureDom() {
  if (typeof document === "undefined") installDom();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
}

const containers = new Set<HTMLElement>();
let browserRuntime: BrowserRuntime | undefined;

// ブラウザ層は開発版の React（act のため）、Flight を作るサーバーは本番版。開発版の Flight クライアントは
// key を検証済みかどうかを開発版のサーバーだけが送る情報で判断するので、サーバーで作られた要素（owner なし）の子の配列すべてに
// key の警告が出る。本番では出ない警告なので、その形のもの（"Check the top-level render call"）だけを捨てる。
// Client Component の中の本当の key の誤りは "Check the render method of ..." になり、捨てない
let consoleFiltered = false;
function filterFlightKeyWarnings() {
  if (consoleFiltered) return;
  consoleFiltered = true;
  const error = console.error;
  console.error = (...args: unknown[]) => {
    const message = args.map(String).join("");
    if (message.includes('unique "key" prop') && message.includes("Check the top-level render call")) return;
    error.apply(console, args);
  };
}
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

export async function render(ui: unknown, { mode = "client", hydrate = false }: RenderOptions = {}): Promise<RenderResult> {
  ensureDom();
  const { stream, serverError } = renderFlight(ui);
  const recoverableErrors: unknown[] = [];

  if (mode === "ssr") {
    if (hydrate) throw new Error('[proofyard] hydrate requires mode: "client"');
    const html = await ssrHtml(stream, serverError);
    const browser = (browserRuntime ??= await harness().loadBrowser());
    const container = document.body.appendChild(document.createElement("div"));
    containers.add(container);
    container.innerHTML = html;
    return { ...browser.within(container), container, html, recoverableErrors, unmount: () => container.remove() };
  }

  const browser = (browserRuntime ??= await harness().loadBrowser());
  filterFlightKeyWarnings();
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
  const response = browser.decode(clientStream);
  try {
    // シェルが届いてから描画する
    await response;
  } catch (error) {
    throw serverError(error);
  }
  // Flight の続きのチャンクでサスペンドするので、非同期の act で描画する
  let utils: ReturnType<BrowserRuntime["render"]> | undefined;
  await browser.act(async () => {
    utils = browser.render(browser.root(response) as any, {
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
    user: browser.userEvent.setup(),
    recoverableErrors,
    unmount: rendered.unmount,
  } as unknown as RenderResult;
}
