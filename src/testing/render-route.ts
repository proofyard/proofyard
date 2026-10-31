import type * as ClientRuntime from "../client/runtime";
/* oxlint-disable typescript/no-explicit-any -- globalThis / Next.js のクライアントの型のない境界を扱う */
// renderRoute（仕様 18.3 / 18.4）: URL を Next.js 本体の handler で HTML にし、document に入れる。
//   ssr:    HTML だけ（JavaScript は動かさない。JavaScript を切ったブラウザと同じ）
//   client: HTML の script（self.__next_f など）を実行し、Next.js 本体のクライアント（app-next.js）でハイドレーションする
// クエリは Testing Library（document.body 全体）。
import { nextHistoryWrite, resetLocation } from "../dom/environment";
import { filterCalls } from "./actions";
import type { ActionCall, ServerActionFunction } from "./actions";
import { ensureDom, harness } from "./render";

type BrowserRuntime = typeof ClientRuntime;
type Queries = ReturnType<BrowserRuntime["within"]>;

export interface RenderRouteOptions {
  mode?: "ssr" | "client";
  // true: シェル（Suspense の fallback）が届いた時点で返す。続きは waitForComplete() で待つ（仕様 6.3）
  streaming?: boolean;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}
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
  waitForFallback: () => Promise<void>;
  // HTML が最後まで届き、Suspense の中身が表示されて（Client Mode ではハイドレーションも）落ち着くまで待つ
  waitForComplete: () => Promise<void>;
  // Testing Library の waitFor（document.title など、クエリで待てないもの）
  waitFor: BrowserRuntime["waitFor"];
  // window に報告されたエラー（ブラウザの window の error イベント。Next.js は Hydration Mismatch などをここに報告する）
  errors: unknown[];
  lifecycle: {
    // after() に渡された処理が終わるまで待つ（仕様 16.2）
    flushAfter: () => Promise<void>;
  };
  // このテストで呼ばれた Server Action（名前か Action そのもので絞る。仕様 18.5）
  actions: {
    getCalls: (action?: string | ServerActionFunction) => ActionCall[];
  };
  // このテストで無効化されたキャッシュタグ（revalidateTag / updateTag / revalidatePath。仕様 11.5）
  cache: { getInvalidatedTags: () => string[] };
  // いまの文書の <head> にある Next.js が描画した metadata（仕様 16.1。遷移すると変わる）
  metadata: RouteMetadata;
  unmount: () => void;
};
export interface RouteMetadata {
  readonly title: string;
  readonly description: string | null;
  // <meta name> または <meta property>（og:title など）の content。同じ名前が複数あれば最初のもの
  get: (name: string) => string | null;
}
interface NavigateOptions {
  scroll?: boolean;
}
export interface RouteRouter {
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  push: (href: string, options?: NavigateOptions) => Promise<void>;
  replace: (href: string, options?: NavigateOptions) => Promise<void>;
  refresh: () => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  // 先読みのリクエストが終わるまで待つ
  prefetch: (href: string) => Promise<void>;
}

const ORIGIN = "http://localhost";
let stopErrors: (() => void) | undefined;
// ページの後片付け（trackPage の戻り値）
let stopPage: (() => void) | undefined;

// テストごとの後片付け（プリロードの afterEach から呼ばれる）
const cleanup = () => {
  const roots = (globalThis as any)[Symbol.for("proofyard.routeRoots")] as
    | Set<{ unmount: () => void }>
    | undefined;
  for (const root of roots ?? []) {
    root.unmount();
  }
  roots?.clear();
  stopErrors?.();
  stopErrors = undefined;
  if (typeof document === "undefined") {
    return;
  }
  const html = document.documentElement;
  // oxlint-disable-next-line unicorn/no-useless-spread -- 回しながら属性を消すので、ライブなコレクションを複製する
  for (const { name } of [...html.attributes]) {
    html.removeAttribute(name);
  }
  html.replaceChildren(
    document.createElement("head"),
    document.createElement("body")
  );
  for (const name of [
    "__next_f",
    "__next_s",
    "next",
    "__NEXT_HYDRATED",
    "__NEXT_HYDRATED_AT",
    "__NEXT_HYDRATED_CB",
  ]) {
    // oxlint-disable-next-line typescript/no-dynamic-delete -- グローバル変数を消す（Reflect.deleteProperty は消せないときに投げない）
    delete (globalThis as any)[name];
  }
  delete (document as any).readyState;
  resetLocation("/");
  stopPage?.();
  stopPage = undefined;
};
(globalThis as any)[Symbol.for("proofyard.routeCleanup")] = cleanup;

// script の中の例外は、ブラウザと同じく window の error イベントに報告する（入れた側には投げない）
const evaluate = (script: Element, code: string) => {
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
  try {
    // oxlint-disable-next-line no-eval -- ブラウザと同じく script をグローバルスコープで実行する（間接 eval）
    (0, eval)(code);
  } catch (error) {
    window.dispatchEvent(
      new ErrorEvent("error", { error, message: String(error) })
    );
  } finally {
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      get: () => null,
    });
  }
};

const runInserted = (script: Element) => {
  const type = script.getAttribute("type");
  if (type && type !== "text/javascript" && type !== "module") {
    return;
  }
  const src = script.getAttribute("src");
  if (!src) {
    return evaluate(script, script.textContent ?? "");
  }
  const url = new URL(src, location.href);
  if (url.origin !== ORIGIN) {
    throw new Error(
      `[proofyard] Unsupported: loading <script src="${src}"> from another origin`
    );
  }
  void (async () => {
    // Next.js のチャンクはバンドルで読み込んでいる
    if (!url.pathname.startsWith(`${harness().assetPrefix}/_next/static/`)) {
      const response = await harness().requestRoute(url.pathname + url.search);
      if (!response.ok) {
        return script.dispatchEvent(new Event("error"));
      }
      evaluate(script, await response.text());
    }
    script.dispatchEvent(new Event("load"));
  })();
};

// ブラウザと同じく、document.createElement で作って文書に入れた <script> を実行する（next/script や React の <script async> など）。
// innerHTML で作った script（React が描画する <script> や、HTML の続きの塊）は、ブラウザでも実行されない。
// 外部の script は同じオリジンのものだけ（メモリ内の handler から取る。public/ など）。届いたら load、失敗したら error を出す
const runInsertedScripts = () => {
  const created = new WeakSet<Element>();
  const { createElement } = Document.prototype;
  // oxlint-disable-next-line func-names -- 名前を付けると関数の name が変わる（元の挙動を保つ）
  Document.prototype.createElement = function (
    this: Document,
    ...args: Parameters<Document["createElement"]>
  ) {
    const element = createElement.apply(this, args);
    if (element.localName === "script") {
      created.add(element);
    }
    return element;
  } as Document["createElement"];
  const { appendChild, insertBefore } = Node.prototype;
  const inserted = (node: Node) => {
    if (node.nodeType !== 1 || !node.isConnected) {
      return;
    }
    const element = node as Element;
    for (const script of element.localName === "script"
      ? [element]
      : [...element.querySelectorAll("script")]) {
      if (created.delete(script)) {
        runInserted(script);
      }
    }
  };
  // oxlint-disable-next-line func-names -- 名前を付けると関数の name が変わる（元の挙動を保つ）
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T) {
    const result = appendChild.call(this, node) as T;
    inserted(node);
    return result;
  };
  // oxlint-disable-next-line func-names -- 名前を付けると関数の name が変わる（元の挙動を保つ）
  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    node: T,
    child: Node | null
  ) {
    const result = insertBefore.call(this, node, child) as T;
    inserted(node);
    return result;
  };
  return () => {
    Document.prototype.createElement = createElement;
    Object.assign(Node.prototype, { appendChild, insertBefore });
  };
};

// ブラウザがページを離れると消えるもの（window / document のイベントリスナー、setInterval）を、ページの読み込みから後片付けまで記録して消す。
// Next.js のクライアントはテストごとに作り直すので、残すと前のテストのモジュールがメモリに残り続ける
const trackPage = () => {
  const undo: (() => void)[] = [];
  for (const target of [window, document] as EventTarget[]) {
    const own = Object.getOwnPropertyDescriptor(target, "addEventListener");
    const add = target.addEventListener;
    target.addEventListener = function addEventListener(
      ...args: Parameters<EventTarget["addEventListener"]>
    ) {
      undo.push(() =>
        target.removeEventListener(
          ...(args as [
            string,
            EventListenerOrEventListenerObject,
            EventListenerOptions?,
          ])
        )
      );
      return add.apply(this, args);
    };
    // turbo-dom の window は自身のプロパティに持つ
    undo.push(() =>
      own
        ? Object.defineProperty(target, "addEventListener", own)
        : delete (target as { addEventListener?: unknown }).addEventListener
    );
  }
  const { setInterval } = globalThis;
  const intervals = new Set<ReturnType<typeof setInterval>>();
  globalThis.setInterval = Object.assign(
    (...args: Parameters<typeof setInterval>) => {
      const id = setInterval(...args);
      intervals.add(id);
      return id;
    },
    setInterval
  );
  undo.push(() => {
    globalThis.setInterval = setInterval;
    for (const id of intervals) {
      clearInterval(id);
    }
  }, runInsertedScripts());
  return () => {
    for (const fn of undo.toReversed()) {
      fn();
    }
  };
};

// 応答の Set-Cookie を cookie の入れ物に反映する
const storeCookies = (jar: Map<string, string>, response: Response) => {
  for (const header of response.headers.getSetCookie()) {
    const cookie = Bun.Cookie.parse(header);
    if (cookie.isExpired()) {
      jar.delete(cookie.name);
    } else {
      jar.set(cookie.name, cookie.value);
    }
  }
};

// ブラウザのページ遷移と同じく、リダイレクトを追いかける
const navigate = async (
  url: string,
  jar: Map<string, string>,
  headers?: Record<string, string>
) => {
  let target = url;
  for (let i = 0; i < 20; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- リダイレクトは順番に追いかける
    const response = await harness().requestRoute(target, {
      cookies: Object.fromEntries(jar),
      headers,
    });
    storeCookies(jar, response);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return { response, url: target };
    }
    const next = new URL(location, ORIGIN + target);
    if (next.origin !== ORIGIN) {
      throw new Error(
        `[proofyard] Unsupported: redirect to another origin (${next.href})`
      );
    }
    target = next.pathname + next.search;
  }
  throw new Error(`[proofyard] too many redirects (${target})`);
};

// HTML で document を置き換える。
// importNode は使わない（turbo-dom 0.5.6 の importNode は子孫の ownerDocument を元の文書のままにする）
const loadDocument = (html: string) => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const root = document.documentElement;
  // oxlint-disable-next-line unicorn/no-useless-spread -- 回しながら属性を消すので、ライブなコレクションを複製する
  for (const { name } of [...root.attributes]) {
    root.removeAttribute(name);
  }
  for (const { name, value } of parsed.documentElement.attributes) {
    root.setAttribute(name, value);
  }
  root.innerHTML = parsed.documentElement.innerHTML;
};

// script を実行する（インラインのもの。Next.js のチャンクはバンドルで読み込む）
const runScript = (script: Element) => {
  const src = script.getAttribute("src");
  if (src?.startsWith(`${harness().assetPrefix}/_next/static/`)) {
    return;
  }
  if (src) {
    throw new Error(
      `[proofyard] Unsupported: external <script src="${src}"> in the HTML`
    );
  }
  const type = script.getAttribute("type");
  if (type && type !== "text/javascript" && type !== "module") {
    return;
  }
  // oxlint-disable-next-line no-eval -- ブラウザと同じく script をグローバルスコープで実行する（間接 eval）
  (0, eval)(script.textContent ?? "");
};
const runScripts = (node: Node) => {
  if (node.nodeType !== 1) {
    return;
  }
  const element = node as Element;
  for (const script of element.tagName === "SCRIPT"
    ? [element]
    : [...element.querySelectorAll("script")]) {
    runScript(script);
  }
};

// ブラウザと同じく、HTML を届いた順に文書に入れる。
// 最初の塊（シェル。<body> を含む）で文書を作り、続きの塊（Suspense の中身の <div hidden> と $RC、self.__next_f の script）は
// body の末尾に足していく（Next.js は </body></html> を最後に回すので、続きは body の中）。
// scripts: script を実行する（Client Mode。SSR Mode は JavaScript を切ったブラウザと同じく実行しない）
const streamDocument = (
  body: ReadableStream<Uint8Array> | null,
  scripts: boolean
) => {
  let html = "";
  let readyState: DocumentReadyState = "loading";
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => readyState,
  });
  // oxlint-disable-next-line typescript/no-invalid-void-type -- 値なしで resolve する（Promise<void>）
  const shell = Promise.withResolvers<void>();
  const done = (async () => {
    const decoder = new TextDecoder();
    const reader = body?.getReader();
    let loaded = false;
    let pending = "";
    for (;;) {
      const { done: streamDone, value } = reader
        ? // oxlint-disable-next-line no-await-in-loop -- ストリームは順番に読む
          await reader.read()
        : { done: true, value: undefined };
      const text = streamDone
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      html += text;
      pending += text;
      // 塊の途中で script が切れていたら続きを待つ
      if (
        !streamDone &&
        pending.split("<script").length !== pending.split("</script>").length
      ) {
        continue;
      }
      if (!loaded) {
        if (!streamDone && !pending.includes("<body")) {
          continue;
        }
        loaded = true;
        loadDocument(pending);
        if (scripts) {
          runScripts(document.documentElement);
        }
        shell.resolve();
      } else if (pending) {
        // turbo-dom 0.5.6 の <template> は content がないので div で解析する（script は innerHTML では実行されない）
        const container = document.createElement("div");
        container.innerHTML = pending;
        // oxlint-disable-next-line unicorn/no-useless-spread -- 回しながら子を移すので、ライブなコレクションを複製する
        for (const node of [...container.childNodes]) {
          document.body.append(node);
          if (scripts) {
            runScripts(node);
          }
        }
      }
      pending = "";
      if (streamDone) {
        break;
      }
    }
    readyState = "interactive";
    document.dispatchEvent(new Event("DOMContentLoaded"));
    readyState = "complete";
    window.dispatchEvent(new Event("load"));
  })();
  done.catch(shell.reject);
  return { done, html: () => html, shell: shell.promise };
};

const metaContent = (name: string) =>
  [...document.head.querySelectorAll("meta")]
    .find(
      (meta) =>
        meta.getAttribute("name") === name ||
        meta.getAttribute("property") === name
    )
    ?.getAttribute("content") ?? null;
const metadata: RouteMetadata = {
  get description() {
    return metaContent("description");
  },
  get: metaContent,
  get title() {
    return document.title;
  },
};

// 待っている Suspense（<!--$?-->）と、中身の表示待ち（<!--$~-->）の目印
const pendingBoundaries = () => {
  const walker = document.createTreeWalker(
    document.documentElement,
    // NodeFilter.SHOW_COMMENT
    128
  );
  let count = 0;
  while (walker.nextNode()) {
    if (/^\$[?~]$/u.test((walker.currentNode as Comment).data)) {
      count += 1;
    }
  }
  return count;
};
const tick = (ms = 0) =>
  // oxlint-disable-next-line promise/avoid-new -- setTimeout を待つ
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// 同じオリジンへの進行中の fetch（ルーターの先読みの完了を待つため）
let inflight = 0;
// React のスケジューラーに残っている作業（src/client/route-react-dom-client.ts）
const reactBusy = (): boolean =>
  (globalThis as any)[Symbol.for("proofyard.routeReactBusy")]?.() ?? false;
const settled = async () => {
  do {
    // oxlint-disable-next-line no-await-in-loop -- 落ち着くまで順番に待つ
    await tick();
    // oxlint-disable-next-line no-unmodified-loop-condition -- inflight は待っている間に routeFetch が変える
  } while (inflight > 0 || reactBusy());
};

// ルーターの操作。Next.js の useRouter のインスタンス（app-router-instance.ts の window.next.router）を使う
const nextRouter = () => {
  const router = (globalThis as any).next?.router;
  if (!router) {
    throw new Error(
      '[proofyard] the Next.js router is not running (use renderRoute with mode: "client")'
    );
  }
  return router;
};
const commit = async (go: () => void) => {
  const written = nextHistoryWrite();
  go();
  await written;
  await settled();
};
const routeRouter = (): RouteRouter => ({
  back: () => commit(() => nextRouter().back()),
  forward: () => commit(() => nextRouter().forward()),
  get pathname() {
    return location.pathname;
  },
  prefetch: async (href) => {
    nextRouter().prefetch(href);
    await settled();
  },
  push: (href, options) => commit(() => nextRouter().push(href, options)),
  refresh: () => commit(() => nextRouter().refresh()),
  replace: (href, options) => commit(() => nextRouter().replace(href, options)),
  get searchParams() {
    return new URLSearchParams(location.search);
  },
});

// クライアントの fetch。cookie はこの入れ物から送り、応答の Set-Cookie を反映する。
// 同じオリジン（http://localhost）への fetch は、プリロードがメモリ内の Next.js の handler に回す
const routeFetch =
  (jar: Map<string, string>, headers?: Record<string, string>) =>
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, location.href),
      init ?? (input instanceof Request ? input : undefined)
    );
    if (new URL(request.url).origin !== ORIGIN) {
      return fetch(request);
    }
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (!request.headers.has(name)) {
        request.headers.set(name, value);
      }
    }
    if (jar.size) {
      request.headers.set(
        "cookie",
        [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ")
      );
    }
    inflight += 1;
    try {
      const response = await fetch(request);
      storeCookies(jar, response);
      return response;
    } finally {
      inflight -= 1;
    }
  };

export const renderRoute = async (
  url: string,
  {
    mode = "client",
    streaming = false,
    headers,
    cookies = {},
  }: RenderRouteOptions = {}
): Promise<RenderRouteResult> => {
  ensureDom();
  // 同じテストの前のページは、ブラウザでページを読み込み直したときと同じく捨てる（React のルートを外してから文書を置き換える）
  cleanup();
  const h = harness();
  const browser = await h.loadBrowser();
  const jar = new Map(Object.entries(cookies));
  const errors: unknown[] = [];
  const onError = (event: Event) => {
    errors.push((event as ErrorEvent).error);
  };
  window.addEventListener("error", onError);
  stopErrors = () => window.removeEventListener("error", onError);
  const { url: finalUrl, response } = await navigate(url, jar, headers);
  resetLocation(finalUrl);
  if (mode === "client") {
    (globalThis as any).__proofyardRouteFetch = routeFetch(jar, headers);
  }
  const page = streamDocument(response.body, mode === "client");
  await page.shell;
  if (mode === "client") {
    // oxlint-disable-next-line promise/avoid-new -- Next.js がハイドレーション後に呼ぶコールバックを Promise にする
    const hydrated = new Promise<void>((resolve) => {
      (globalThis as any).__NEXT_HYDRATED_CB = resolve;
    });
    // Next.js のクライアントは読み込み中の <script>（document.currentScript）から assetPrefix を求める（client/asset-prefix.ts）
    const main = document.querySelector(
      `script[src^="${h.assetPrefix}/_next/static/chunks/main-app"]`
    );
    if (!main) {
      throw new Error(
        `[proofyard] the HTML (status ${response.status}) has no Next.js client script (main-app)`
      );
    }
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      get: () => main,
    });
    stopPage = trackPage();
    try {
      const bundle = await import(await h.routeBundle());
      bundle.default();
    } finally {
      Object.defineProperty(document, "currentScript", {
        configurable: true,
        get: () => null,
      });
    }
    // HTML の読み込みの失敗はハイドレーションを待たずに投げる
    await Promise.race([hydrated, page.done.then(() => hydrated)]);
  }
  const waitForComplete = async () => {
    await page.done;
    // SSR Mode は script を実行しないので、後から届いた Suspense の中身は（JavaScript を切ったブラウザと同じく）表示されない
    if (mode !== "client") {
      return;
    }
    // React の $RC は中身の表示をまとめて少し遅らせる（requestAnimationFrame / setTimeout）。表示とハイドレーションを待つ
    while (pendingBoundaries() > 0) {
      // oxlint-disable-next-line no-await-in-loop -- 表示されるまで順番に待つ
      await tick(10);
    }
    await settled();
  };
  const waitForFallback = async () => {
    for (;;) {
      if (pendingBoundaries() > 0) {
        return;
      }
      // oxlint-disable-next-line no-await-in-loop -- 表示されるまで順番に待つ
      const finished = await Promise.race([
        page.done.then(() => true),
        tick(10).then(() => false),
      ]);
      if (finished && pendingBoundaries() === 0) {
        throw new Error(
          "[proofyard] the page finished without showing a Suspense fallback"
        );
      }
    }
  };
  if (!streaming) {
    await waitForComplete();
  }
  return {
    ...browser.within(document.body),
    actions: { getCalls: (action) => filterCalls(h.actionCalls(), action) },
    cache: { getInvalidatedTags: h.invalidatedTags },
    cookies: jar,
    errors,
    headers: response.headers,
    get html() {
      return page.html();
    },
    lifecycle: { flushAfter: h.flushAfter },
    metadata,
    router: routeRouter(),
    status: response.status,
    unmount: cleanup,
    url: finalUrl,
    user: browser.userEvent.setup({ document }),
    waitFor: browser.waitFor,
    waitForComplete,
    waitForFallback,
  } as unknown as RenderRouteResult;
};
