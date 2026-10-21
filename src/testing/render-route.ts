// renderRoute（仕様 18.3 / 18.4）: URL を Next.js 本体の handler で HTML にし、document に入れる。
//   ssr:    HTML だけ（JavaScript は動かさない。JavaScript を切ったブラウザと同じ）
//   client: HTML の script（self.__next_f など）を実行し、Next.js 本体のクライアント（app-next.js）でハイドレーションする
// クエリは Testing Library（document.body 全体）。
import { nextHistoryWrite, resetLocation } from "../dom/environment";
import { ensureDom, harness } from "./render";

type BrowserRuntime = typeof import("../client/runtime");
type Queries = ReturnType<BrowserRuntime["within"]>;

export type RenderRouteOptions = {
  mode?: "ssr" | "client";
  // true: シェル（Suspense の fallback）が届いた時点で返す。続きは waitForComplete() で待つ（仕様 6.3）
  streaming?: boolean;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
};
export type RenderRouteResult = Queries & {
  // 最後の応答（リダイレクトは追いかけた後）
  status: number;
  headers: Headers;
  // ここまでに届いた HTML
  readonly html: string;
  // リダイレクトを追いかけた後の URL
  url: string;
  user: ReturnType<BrowserRuntime["userEvent"]["setup"]>;
  // ブラウザが送る cookie（応答の Set-Cookie を反映したもの）
  cookies: Map<string, string>;
  // Next.js のクライアントルーター（useRouter と同じもの）。遷移は新しい状態がコミットされるまで待つ
  router: RouteRouter;
  // まだ届いていない Suspense の fallback が表示されるまで待つ（出ないまま HTML が終わったらエラー）
  waitForFallback(): Promise<void>;
  // HTML が最後まで届き、Suspense の中身が表示されて（Client Mode ではハイドレーションも）落ち着くまで待つ
  waitForComplete(): Promise<void>;
  // Testing Library の waitFor（document.title など、クエリで待てないもの）
  waitFor: BrowserRuntime["waitFor"];
  // window に報告されたエラー（ブラウザの window の error イベント。Next.js は Hydration Mismatch などをここに報告する）
  errors: unknown[];
  lifecycle: {
    // after() に渡された処理が終わるまで待つ（仕様 16.2）
    flushAfter(): Promise<void>;
  };
  // いまの文書の <head> にある Next.js が描画した metadata（仕様 16.1。遷移すると変わる）
  metadata: RouteMetadata;
  unmount(): void;
};
export type RouteMetadata = {
  readonly title: string;
  readonly description: string | null;
  // <meta name> または <meta property>（og:title など）の content。同じ名前が複数あれば最初のもの
  get(name: string): string | null;
};
type NavigateOptions = { scroll?: boolean };
export type RouteRouter = {
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  push(href: string, options?: NavigateOptions): Promise<void>;
  replace(href: string, options?: NavigateOptions): Promise<void>;
  refresh(): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  // 先読みのリクエストが終わるまで待つ
  prefetch(href: string): Promise<void>;
};

const ORIGIN = "http://localhost";
let bundles = 0;
let stopErrors: (() => void) | undefined;

// テストごとの後片付け（プリロードの afterEach から呼ばれる）
function cleanup() {
  const roots = (globalThis as any)[Symbol.for("proofyard.routeRoots")] as Set<{ unmount(): void }> | undefined;
  for (const root of roots ?? []) root.unmount();
  roots?.clear();
  stopErrors?.();
  stopErrors = undefined;
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  for (const { name } of Array.from(html.attributes)) html.removeAttribute(name);
  html.replaceChildren(document.createElement("head"), document.createElement("body"));
  for (const name of ["__next_f", "__next_s", "next", "__NEXT_HYDRATED", "__NEXT_HYDRATED_AT", "__NEXT_HYDRATED_CB"]) delete (globalThis as any)[name];
  delete (document as any).readyState;
  resetLocation("/");
}
(globalThis as any)[Symbol.for("proofyard.routeCleanup")] = cleanup;

// 応答の Set-Cookie を cookie の入れ物に反映する
function storeCookies(jar: Map<string, string>, response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const cookie = Bun.Cookie.parse(header);
    if (cookie.isExpired()) jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}

// ブラウザのページ遷移と同じく、リダイレクトを追いかける
async function navigate(url: string, jar: Map<string, string>, headers?: Record<string, string>) {
  for (let i = 0; i < 20; i++) {
    const response = await harness().requestRoute(url, { headers, cookies: Object.fromEntries(jar) });
    storeCookies(jar, response);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return { url, response };
    const next = new URL(location, ORIGIN + url);
    if (next.origin !== ORIGIN) throw new Error(`[proofyard] Unsupported: redirect to another origin (${next.href})`);
    url = next.pathname + next.search;
  }
  throw new Error(`[proofyard] too many redirects (${url})`);
}

// HTML で document を置き換える。
// importNode は使わない（turbo-dom 0.5.6 の importNode は子孫の ownerDocument を元の文書のままにする）
function loadDocument(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const root = document.documentElement;
  for (const { name } of Array.from(root.attributes)) root.removeAttribute(name);
  for (const { name, value } of Array.from(parsed.documentElement.attributes)) root.setAttribute(name, value);
  root.innerHTML = parsed.documentElement.innerHTML;
}

// script を実行する（インラインのもの。Next.js のチャンクはバンドルで読み込む）
function runScript(script: Element) {
  const src = script.getAttribute("src");
  if (src?.startsWith("/_next/static/")) return;
  if (src) throw new Error(`[proofyard] Unsupported: external <script src="${src}"> in the HTML`);
  const type = script.getAttribute("type");
  if (type && type !== "text/javascript" && type !== "module") return;
  (0, eval)(script.textContent ?? "");
}
const runScripts = (node: Node) => {
  if (node.nodeType !== 1) return;
  const element = node as Element;
  for (const script of element.tagName === "SCRIPT" ? [element] : Array.from(element.querySelectorAll("script"))) runScript(script);
};

// ブラウザと同じく、HTML を届いた順に文書に入れる。
// 最初の塊（シェル。<body> を含む）で文書を作り、続きの塊（Suspense の中身の <div hidden> と $RC、self.__next_f の script）は
// body の末尾に足していく（Next.js は </body></html> を最後に回すので、続きは body の中）。
// scripts: script を実行する（Client Mode。SSR Mode は JavaScript を切ったブラウザと同じく実行しない）
function streamDocument(body: ReadableStream<Uint8Array> | null, scripts: boolean) {
  let html = "";
  let readyState: DocumentReadyState = "loading";
  Object.defineProperty(document, "readyState", { configurable: true, get: () => readyState });
  const shell = Promise.withResolvers<void>();
  const done = (async () => {
    const decoder = new TextDecoder();
    const reader = body?.getReader();
    let loaded = false;
    let pending = "";
    for (;;) {
      const { done, value } = reader ? await reader.read() : { done: true, value: undefined };
      const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
      html += text;
      pending += text;
      // 塊の途中で script が切れていたら続きを待つ
      if (!done && pending.split("<script").length !== pending.split("</script>").length) continue;
      if (!loaded) {
        if (!done && !pending.includes("<body")) continue;
        loaded = true;
        loadDocument(pending);
        if (scripts) runScripts(document.documentElement);
        shell.resolve();
      } else if (pending) {
        // turbo-dom 0.5.6 の <template> は content がないので div で解析する（script は innerHTML では実行されない）
        const container = document.createElement("div");
        container.innerHTML = pending;
        for (const node of Array.from(container.childNodes)) {
          document.body.appendChild(node);
          if (scripts) runScripts(node);
        }
      }
      pending = "";
      if (done) break;
    }
    readyState = "interactive";
    document.dispatchEvent(new Event("DOMContentLoaded"));
    readyState = "complete";
    window.dispatchEvent(new Event("load"));
  })();
  done.catch(shell.reject);
  return { shell: shell.promise, done, html: () => html };
}

const metaContent = (name: string) =>
  (Array.from(document.head.getElementsByTagName("meta")).find((meta) => meta.getAttribute("name") === name || meta.getAttribute("property") === name)?.getAttribute("content")) ??
  null;
const metadata: RouteMetadata = {
  get title() {
    return document.title;
  },
  get description() {
    return metaContent("description");
  },
  get: metaContent,
};

// 待っている Suspense（<!--$?-->）と、中身の表示待ち（<!--$~-->）の目印
function pendingBoundaries() {
  const walker = document.createTreeWalker(document.documentElement, 128 /* NodeFilter.SHOW_COMMENT */);
  let count = 0;
  while (walker.nextNode()) if (/^\$[?~]$/.test((walker.currentNode as Comment).data)) count++;
  return count;
}
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// 同じオリジンへの進行中の fetch（ルーターの先読みの完了を待つため）
let inflight = 0;
// React のスケジューラーに残っている作業（src/client/route-react-dom-client.ts）
const reactBusy = (): boolean => (globalThis as any)[Symbol.for("proofyard.routeReactBusy")]?.() ?? false;
const settled = async () => {
  do await tick();
  while (inflight > 0 || reactBusy());
};

// ルーターの操作。Next.js の useRouter のインスタンス（app-router-instance.ts の window.next.router）を使う
function routeRouter(): RouteRouter {
  const next = () => {
    const router = (globalThis as any).next?.router;
    if (!router) throw new Error('[proofyard] the Next.js router is not running (use renderRoute with mode: "client")');
    return router;
  };
  const commit = async (navigate: () => void) => {
    const written = nextHistoryWrite();
    navigate();
    await written;
    await settled();
  };
  return {
    get pathname() {
      return location.pathname;
    },
    get searchParams() {
      return new URLSearchParams(location.search);
    },
    push: (href, options) => commit(() => next().push(href, options)),
    replace: (href, options) => commit(() => next().replace(href, options)),
    refresh: () => commit(() => next().refresh()),
    back: () => commit(() => next().back()),
    forward: () => commit(() => next().forward()),
    prefetch: async (href) => {
      next().prefetch(href);
      await settled();
    },
  };
}

// クライアントの fetch。cookie はこの入れ物から送り、応答の Set-Cookie を反映する。
// 同じオリジン（http://localhost）への fetch は、プリロードがメモリ内の Next.js の handler に回す
function routeFetch(jar: Map<string, string>, headers?: Record<string, string>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(new URL(input instanceof Request ? input.url : input, location.href), init ?? (input instanceof Request ? input : undefined));
    if (new URL(request.url).origin !== ORIGIN) return fetch(request);
    for (const [name, value] of Object.entries(headers ?? {})) if (!request.headers.has(name)) request.headers.set(name, value);
    if (jar.size) request.headers.set("cookie", [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "));
    inflight++;
    try {
      const response = await fetch(request);
      storeCookies(jar, response);
      return response;
    } finally {
      inflight--;
    }
  };
}

export async function renderRoute(url: string, { mode = "client", streaming = false, headers, cookies = {} }: RenderRouteOptions = {}): Promise<RenderRouteResult> {
  ensureDom();
  const h = harness();
  const browser = await h.loadBrowser();
  const jar = new Map(Object.entries(cookies));
  const errors: unknown[] = [];
  const onError = (event: Event) => void errors.push((event as ErrorEvent).error);
  stopErrors?.();
  window.addEventListener("error", onError);
  stopErrors = () => window.removeEventListener("error", onError);
  const { url: finalUrl, response } = await navigate(url, jar, headers);
  resetLocation(finalUrl);
  if (mode === "client") (globalThis as any).__proofyardRouteFetch = routeFetch(jar, headers);
  const page = streamDocument(response.body, mode === "client");
  await page.shell;
  if (mode === "client") {
    const hydrated = new Promise<void>((resolve) => ((globalThis as any).__NEXT_HYDRATED_CB = resolve));
    // Next.js のクライアントは読み込み中の <script>（document.currentScript）から assetPrefix を求める（client/asset-prefix.ts）
    const main = document.querySelector('script[src^="/_next/static/chunks/main-app"]');
    if (!main) throw new Error(`[proofyard] the HTML (status ${response.status}) has no Next.js client script (main-app)`);
    Object.defineProperty(document, "currentScript", { configurable: true, get: () => main });
    try {
      await import(`${await h.routeBundle()}?route=${bundles++}`);
    } finally {
      Object.defineProperty(document, "currentScript", { configurable: true, get: () => null });
    }
    // HTML の読み込みの失敗はハイドレーションを待たずに投げる
    await Promise.race([hydrated, page.done.then(() => hydrated)]);
  }
  const waitForComplete = async () => {
    await page.done;
    // SSR Mode は script を実行しないので、後から届いた Suspense の中身は（JavaScript を切ったブラウザと同じく）表示されない
    if (mode !== "client") return;
    // React の $RC は中身の表示をまとめて少し遅らせる（requestAnimationFrame / setTimeout）。表示とハイドレーションを待つ
    while (pendingBoundaries() > 0) await tick(10);
    await settled();
  };
  const waitForFallback = async () => {
    for (;;) {
      if (pendingBoundaries() > 0) return;
      const finished = await Promise.race([page.done.then(() => true), tick(10).then(() => false)]);
      if (finished && pendingBoundaries() === 0) throw new Error("[proofyard] the page finished without showing a Suspense fallback");
    }
  };
  if (!streaming) await waitForComplete();
  return {
    ...browser.within(document.body),
    status: response.status,
    headers: response.headers,
    get html() {
      return page.html();
    },
    url: finalUrl,
    user: browser.userEvent.setup({ document }),
    cookies: jar,
    router: routeRouter(),
    waitForFallback,
    waitForComplete,
    waitFor: browser.waitFor,
    errors,
    lifecycle: { flushAfter: h.flushAfter },
    metadata,
    unmount: cleanup,
  } as unknown as RenderRouteResult;
}
