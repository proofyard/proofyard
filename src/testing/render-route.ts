// renderRoute（仕様 18.3 / 18.4）: URL を Next.js 本体の handler で HTML にし、document に入れる。
//   ssr:    HTML だけ（JavaScript は動かさない。JavaScript を切ったブラウザと同じ）
//   client: HTML の script（self.__next_f など）を実行し、Next.js 本体のクライアント（app-next.js）でハイドレーションする
// クエリは Testing Library（document.body 全体）。
import { resetLocation } from "../dom/environment";
import { ensureDom, harness } from "./render";

type BrowserRuntime = typeof import("../client/runtime");
type Queries = ReturnType<BrowserRuntime["within"]>;

export type RenderRouteOptions = {
  mode?: "ssr" | "client";
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
};
export type RenderRouteResult = Queries & {
  // 最後の応答（リダイレクトは追いかけた後）
  status: number;
  headers: Headers;
  html: string;
  // リダイレクトを追いかけた後の URL
  url: string;
  user: ReturnType<BrowserRuntime["userEvent"]["setup"]>;
  // ブラウザが送る cookie（応答の Set-Cookie を反映したもの）
  cookies: Map<string, string>;
  unmount(): void;
};

const ORIGIN = "http://localhost";
let bundles = 0;

// テストごとの後片付け（プリロードの afterEach から呼ばれる）
function cleanup() {
  const roots = (globalThis as any)[Symbol.for("proofyard.routeRoots")] as Set<{ unmount(): void }> | undefined;
  for (const root of roots ?? []) root.unmount();
  roots?.clear();
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  for (const { name } of Array.from(html.attributes)) html.removeAttribute(name);
  html.replaceChildren(document.createElement("head"), document.createElement("body"));
  for (const name of ["__next_f", "__next_s", "next", "__NEXT_HYDRATED", "__NEXT_HYDRATED_AT", "__NEXT_HYDRATED_CB"]) delete (globalThis as any)[name];
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

// HTML の script を文書の順に実行する（インラインのもの。Next.js のチャンクはバンドルで読み込む）
function runScripts() {
  for (const script of Array.from(document.querySelectorAll("script"))) {
    const src = script.getAttribute("src");
    if (src?.startsWith("/_next/static/")) continue;
    if (src) throw new Error(`[proofyard] Unsupported: external <script src="${src}"> in the HTML`);
    const type = script.getAttribute("type");
    if (type && type !== "text/javascript" && type !== "module") continue;
    (0, eval)(script.textContent ?? "");
  }
}

// クライアントの fetch。cookie はこの入れ物から送り、応答の Set-Cookie を反映する。
// 同じオリジン（http://localhost）への fetch は、プリロードがメモリ内の Next.js の handler に回す
function routeFetch(jar: Map<string, string>, headers?: Record<string, string>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(new URL(input instanceof Request ? input.url : input, location.href), init ?? (input instanceof Request ? input : undefined));
    if (new URL(request.url).origin !== ORIGIN) return fetch(request);
    for (const [name, value] of Object.entries(headers ?? {})) if (!request.headers.has(name)) request.headers.set(name, value);
    if (jar.size) request.headers.set("cookie", [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "));
    const response = await fetch(request);
    storeCookies(jar, response);
    return response;
  };
}

export async function renderRoute(url: string, { mode = "client", headers, cookies = {} }: RenderRouteOptions = {}): Promise<RenderRouteResult> {
  ensureDom();
  const h = harness();
  const browser = await h.loadBrowser();
  const jar = new Map(Object.entries(cookies));
  const { url: finalUrl, response } = await navigate(url, jar, headers);
  const html = await response.text();
  resetLocation(finalUrl);
  loadDocument(html);
  if (mode === "client") {
    (globalThis as any).__proofyardRouteFetch = routeFetch(jar, headers);
    const hydrated = new Promise<void>((resolve) => ((globalThis as any).__NEXT_HYDRATED_CB = resolve));
    runScripts();
    // Next.js のクライアントは読み込み中の <script>（document.currentScript）から assetPrefix を求める（client/asset-prefix.ts）
    const main = document.querySelector('script[src^="/_next/static/chunks/main-app"]');
    if (!main) throw new Error("[proofyard] the HTML has no Next.js client script (main-app)");
    Object.defineProperty(document, "currentScript", { configurable: true, get: () => main });
    try {
      await import(`${await h.routeBundle()}?route=${bundles++}`);
    } finally {
      Object.defineProperty(document, "currentScript", { configurable: true, get: () => null });
    }
    await hydrated;
  }
  return {
    ...browser.within(document.body),
    status: response.status,
    headers: response.headers,
    html,
    url: finalUrl,
    user: browser.userEvent.setup({ document }),
    cookies: jar,
    unmount: cleanup,
  } as unknown as RenderRouteResult;
}
