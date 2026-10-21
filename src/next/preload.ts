// Next.js モードのプリロード: App Router のアプリを、Next.js 本体の実装でビルド（層ごと）してリクエストを処理する。
// - ルートツリーとエントリ: next-app-loader（next build と同じ生成コード）
// - 設定: loadConfig、manifest: `next start` と同じ形の .next を一時ディレクトリに書く
// - リクエスト処理: エントリの handler（app-page テンプレート）
require("next/dist/server/node-environment-baseline"); // globalThis.AsyncLocalStorage
// Next.js の runtime バンドル（vendored React を含む）。層をまたいで共有する
require("next/dist/server/route-modules/app-page/module.compiled");
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { actionModule, serverActions } from "../testing/actions";
import { ALIASES, BUNDLED_ALIASES, USE_CLIENT, buildLayer, clientIds, clientReferenceStub, esmClientIds } from "./layers";

// 対象アプリ（next.config と app/ のあるディレクトリ）。既定は bun test を実行したディレクトリ
// ponytail: 環境変数で受け取る。設定ファイル（proofyard.config 等）は必要になったら
const projectDir = resolve(process.env.PROOFYARD_NEXT_APP ?? process.cwd());
const appDir = join(projectDir, "app");
const work = join(tmpdir(), `proofyard-next-${process.pid}`);
const generatedDir = join(work, "entries");
const distDir = join(work, "dist");
const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
};

const { default: nextAppLoader } = require("next/dist/build/webpack/loaders/next-app-loader/index.js");
const { default: loadConfig } = require("next/dist/server/config");
const { PHASE_PRODUCTION_BUILD } = require("next/dist/shared/lib/constants");
const { normalizeAppPath } = require("next/dist/shared/lib/router/utils/app-paths");
const { getSortedRoutes } = require("next/dist/shared/lib/router/utils/sorted-routes");
const { getRouteRegex } = require("next/dist/shared/lib/router/utils/route-regex");
const { createRequestResponseMocks } = require("next/dist/server/lib/mock-request");
const { getDefineEnv } = require("next/dist/build/define-env");
const { transformSync } = require("next/dist/build/swc");
const { getLoaderSWCOptions } = require("next/dist/build/swc/options");

let t = performance.now();
const config = await loadConfig(PHASE_PRODUCTION_BUILD, projectDir, { silent: true });
const pageExtensions: string[] = config.pageExtensions;

// app/ の page / route ファイル → next build のエントリ（page は "/dashboard/users/[id]/page" の形）
const pageFiles = [...new Bun.Glob(`**/{page,route}.{${pageExtensions.join(",")}}`).scanSync(appDir)];
const pages = pageFiles.map((file) => ({ file, page: "/" + file.replace(/\.[^.]+$/, "") }));
const routes = new Map<string, { page: string; entry: string }>(); // pathname → エントリ
for (const [i, { file, page }] of pages.entries()) {
  const code: string = await nextAppLoader.call({
    getOptions: () => ({
      name: `app${page}`,
      page,
      appDir,
      appPaths: [page],
      allNormalizedAppPaths: pages.map((p) => normalizeAppPath(p.page)),
      pagePath: `private-next-app-dir/${file}`,
      pageExtensions,
      rootDir: projectDir,
      isDev: false,
      basePath: config.basePath,
      middlewareConfig: Buffer.from("{}").toString("base64"),
      nextConfigOutput: config.output ?? "", // webpack ではクエリ文字列で渡るので未設定は ""
    }),
    addMissingDependency() {},
    addDependency() {},
    addContextDependency() {},
    _module: { buildInfo: {} },
  });
  const entry = join(generatedDir, `${i}.js`);
  write(
    entry,
    code
      .replace(/\s+with\s*\{\s*'turbopack-transition'[^}]*\}/g, "") // Turbopack 用の import 属性
      // Client Component の読み込み（webpack の __webpack_require__ の代わり）
      .replace("const __next_app_require__ = __webpack_require__", "const __next_app_require__ = (id) => globalThis.__proofyardNextRequire(id)"),
  );
  routes.set(normalizeAppPath(page), { page, entry });
}
console.log(`[proofyard] next-app-loader: ${routes.size} routes ${(performance.now() - t).toFixed(0)}ms`);

t = performance.now();
// next build と同じ define（nodejs のサーバー。bun test の NODE_ENV=test は production 扱い）
const nextDefine: Record<string, unknown> = getDefineEnv({
  isTurbopack: false,
  config,
  dev: process.env.NODE_ENV === "development",
  distDir,
  projectPath: projectDir,
  fetchCacheKeyPrefix: config.experimental.fetchCacheKeyPrefix,
  hasRewrites: false,
  isClient: false,
  isEdgeServer: false,
  isNodeServer: true,
  middlewareMatchers: undefined,
  rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
});
// webpack の DefinePlugin と同じく undefined は undefined に（Bun.build は文字列だけ受け付ける）
const define = Object.fromEntries(Object.entries(nextDefine).map(([k, v]) => [k, typeof v === "string" ? v : String(v)]));
// rsc 層のアプリのソースは next-swc-loader と同じ SWC 変換（"use cache" / "use server" はここで変換される）
const encryptionKey = randomBytes(32).toString("base64");
// アプリのソースファイル（node_modules と隠しディレクトリ（.next など）を除く）
function* appSources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* appSources(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) yield path;
  }
}
const dev = process.env.NODE_ENV === "development";
const jsConfig = { compilerOptions: {} }; // ponytail: tsconfig の paths / baseUrl は未対応（Next.js は loadJsConfig で読む）
// next-swc-loader と同じ SWC の設定（層ごと。webpack-config.ts の swcLoader の設定）
// browser は act のために開発版の React にしている（loadBrowser）ので development。route（renderRoute）は next build と同じ
const SWC_LAYERS = {
  rsc: { isServer: true, bundleLayer: "rsc", development: dev },
  ssr: { isServer: true, bundleLayer: "ssr", development: dev },
  browser: { isServer: false, bundleLayer: "app-pages-browser", development: true },
  route: { isServer: false, bundleLayer: "app-pages-browser", development: dev },
} as const;
const swcOptions = (filename: string, layer: keyof typeof SWC_LAYERS = "rsc") =>
  getLoaderSWCOptions({
    filename,
    ...SWC_LAYERS[layer],
    appDir,
    isPageFile: false,
    isCacheComponents: config.cacheComponents,
    hasReactRefresh: false,
    configDir: projectDir,
    modularizeImports: config.modularizeImports,
    optimizePackageImports: config.experimental.optimizePackageImports,
    swcPlugins: config.experimental.swcPlugins,
    compilerOptions: config.compiler,
    optimizeServerReact: config.experimental.optimizeServerReact,
    jsConfig,
    supportedBrowsers: undefined,
    swcCacheDir: join(work, "swc"),
    relativeFilePathFromRoot: relative(projectDir, filename),
    serverComponents: true,
    serverReferenceHashSalt: encryptionKey,
    esm: true,
    cacheHandlers: config.cacheHandlers,
    useCacheEnabled: config.experimental.useCache,
    taintEnabled: config.experimental.taint,
    trackDynamicImports: !!config.cacheComponents && SWC_LAYERS[layer].isServer,
    pageExtensions,
  });
// ネイティブ読み込み時の SWC 変換（同期。非同期の onLoad を経たモジュールは require できない。route.ts は require で読まれる）
const swcTransformSync = (filename: string, source: string): string =>
  transformSync(source, { ...swcOptions(filename), filename, sourceFileName: filename }).code;
// SSR 層・ブラウザ層のアプリのソース（Client Component）の変換（typeof window の置き換えなども Next.js と同じになる）
const isAppSource = (path: string) => path.startsWith(projectDir + "/") && !path.includes("/node_modules/");
const swcTransformFor = (layer: "ssr" | "browser" | "route") => async (filename: string, source: string) =>
  isAppSource(filename) ? (transformSync(source, { ...swcOptions(filename, layer), filename, sourceFileName: filename }).code as string) : undefined;
const entries = [...routes.values()].map((r) => r.entry);

// rsc 層: Next.js 本体だけをバンドルし、アプリはネイティブで読み込む（mock.module が効く）。
// アプリが import しうる Next.js 本体のモジュール（next/cache などの公開の入口、SWC が出力する private-next-rsc-* など）も
// 同じバンドルの入口にする。ネイティブで読むと define が効かず（NODE_ENV など）、本番と違うコードが動くため
const nextFacades = new Map<string, string>(); // 指定子 → ファイル
for (const [spec, target] of Object.entries(BUNDLED_ALIASES.rsc)) nextFacades.set(spec, Bun.resolveSync(target, process.cwd()));
// App Router の公開の入口（Pages Router 専用のもの（next/document など）は rsc 層では使わない）
// ponytail: 一覧にない next/* をネイティブで読むと define が効かない。必要になったら一覧に足す
// （next/og は画像生成で重いので除いている）
const APP_ROUTER_ENTRIES = ["cache", "headers", "server", "image", "script", "root-params", "constants"];
for (const name of APP_ROUTER_ENTRIES) {
  const spec = `next/${name}`;
  if (nextFacades.has(spec)) continue;
  try {
    nextFacades.set(spec, Bun.resolveSync(spec, process.cwd()));
  } catch {
    // このバージョンの Next.js にない入口
  }
}
// 入口は名前空間を default で渡す小さな ESM（入口を直接使うと、CJS → ESM 変換や export * の再エクスポートで export を取りこぼす）
// プリロード自身が使う Next.js 本体のモジュール（バンドルの中のものを使う。ネイティブで読むと別の複製になる）
const MANIFESTS_SINGLETON = Bun.resolveSync("next/dist/server/app-render/manifests-singleton", process.cwd());
const facadeEntries = new Map<string, string>(); // ファイル → 入口
for (const file of new Set([...nextFacades.values(), MANIFESTS_SINGLETON])) {
  const entry = join(generatedDir, `facade-${facadeEntries.size}.mjs`);
  write(entry, `import * as m from ${JSON.stringify(file)};\nexport default m;\n`);
  facadeEntries.set(file, entry);
}
const rsc = await buildLayer("rsc", [...entries, ...facadeEntries.values()], { define, generatedDir, nativeDir: projectDir });

// アプリの "use client" ファイルを Client Reference として登録する（Next.js 本体のものは rsc 層のビルドで登録済み）
const sourceLoader = (path: string) => (path.match(/\.([jt]sx?)$/)?.[1] ?? "js") as "js" | "jsx" | "ts" | "tsx";
// Server Action の id → ファイル（next build は SWC の変換結果から集めて server-reference-manifest.json に書く）
const actionFiles = new Map<string, string>();
for (const path of appSources(projectDir)) {
  const source = readFileSync(path, "utf8");
  if (/["']use server["']/.test(source))
    for (const m of swcTransformSync(path, source).matchAll(/registerServerReference\([^,]+,\s*"([0-9a-f]+)"/g)) actionFiles.set(m[1]!, path);
  if (USE_CLIENT.test(source)) {
    clientReferenceStub(path, source);
    continue;
  }
  // サードパーティの "use client" はネイティブで読むとサーバーで実行されてしまうので Fail Closed
  // ponytail: アプリが直接 import するファイルだけを見る（パッケージの奥の "use client" は検出できない）
  for (const { path: spec } of new Bun.Transpiler({ loader: sourceLoader(path) }).scanImports(source)) {
    if (/^(?:\.|\/|node:|bun:|next\/|react)/.test(spec) || spec === "next") continue;
    let resolved: string;
    try {
      resolved = Bun.resolveSync(spec, dirname(path));
    } catch {
      continue;
    }
    if (resolved.includes("/node_modules/") && USE_CLIENT.test(readFileSync(resolved, "utf8")))
      throw new Error(`[proofyard] Unsupported: "use client" modules in node_modules are not supported yet (${spec} from ${path})`);
  }
}
const SSR_RUNTIME = join(import.meta.dir, "ssr-runtime.ts");
const ssr = await buildLayer("ssr", [...clientIds, SSR_RUNTIME], { define, transform: swcTransformFor("ssr") });

// ネイティブで読み込むアプリ（と、その依存）の rsc 層の解決と変換
// - react などは Next.js 内蔵の React に（build.module は CJS の require も含めて置き換える）
// - アプリのソースは SWC で変換し、"use client" は Client Reference に
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
Bun.plugin({
  name: "proofyard-next-rsc-native",
  setup(build) {
    for (const [spec, target] of Object.entries(ALIASES.rsc))
      build.module(spec, () => ({ exports: require(Bun.resolveSync(target, process.cwd())), loader: "object" }));
    for (const [spec, file] of nextFacades)
      // CJS は default が module.exports、ESM（next/dist/api/* など）は名前付きの export。webpack の require と同じ形にまとめる
      build.module(spec, () => {
        const m = require(rsc.get(facadeEntries.get(file)!)!).default;
        const cjs = m.default !== null && typeof m.default === "object" ? m.default : {};
        const exports = { ...cjs, ...m };
        // SWC の "use server" の変換結果が呼ぶ。Action の id → 関数を記録する（src/testing/actions.ts）
        if (spec === "private-next-rsc-server-reference") {
          const register = exports.registerServerReference;
          exports.registerServerReference = (action: Function, id: string, exportName: string | null) => {
            serverActions.set(id, action);
            return register(action, id, exportName);
          };
        }
        return { exports, loader: "object" };
      });
    build.onLoad({ filter: new RegExp(`^${escape(projectDir)}/(?!.*/node_modules/).*\\.[jt]sx?$`) }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (USE_CLIENT.test(source)) return { contents: clientReferenceStub(args.path, source), loader: "js" };
      return { contents: swcTransformSync(args.path, source), loader: "js" };
    });
  },
});
console.log(`[proofyard] rsc+ssr layers: ${(performance.now() - t).toFixed(0)}ms, client references: ${clientIds.size}`);
t = performance.now();

// SSR 層の Client Component（webpack の require と同じく CJS は module.exports、ESM は名前空間）
const ssrModules = new Map<string, unknown>();
for (const [id, out] of ssr) {
  const m = await import(out);
  ssrModules.set(id, esmClientIds.has(id) || id === SSR_RUNTIME ? m : m.default);
}
// Next.js の handler が Server Action を読むモジュール（server-reference-manifest.json の moduleId）。
// webpack ではファイルの Action を id の名前で export するモジュール（next-flight-action-entry-loader）
const ACTION_FILE_PREFIX = "proofyard-server-action-file:";
(globalThis as any).__proofyardNextRequire = (id: string) => {
  if (id.startsWith(ACTION_FILE_PREFIX)) {
    require(id.slice(ACTION_FILE_PREFIX.length));
    return new Proxy({}, { get: (_, actionId) => (typeof actionId === "string" ? serverActions.get(actionId) : undefined) });
  }
  // renderRSC の Client Reference（実行しない代わりのモジュール。src/testing/render-rsc.ts）
  // Server Action（decodeReply が引数の中の Server Reference を読むとき）
  const action = actionModule(id);
  if (action) return action;
  const placeholder = (globalThis as any)[Symbol.for("proofyard.clientReferencePlaceholder")]?.(id);
  if (placeholder) return placeholder;
  if (!ssrModules.has(id)) throw new Error(`[proofyard] unknown client module ${id}`);
  return ssrModules.get(id);
};

// `next start` が読む .next（route-module.ts の loadManifests）
const key = () => randomBytes(32).toString("hex");
const preview = { previewModeId: key(), previewModeSigningKey: key(), previewModeEncryptionKey: key() };
const clientEntry = (id: string) => ({ id, name: "*", chunks: [], async: false });
const clientReferenceManifest = {
  clientModules: Object.fromEntries([...clientIds].map((id) => [id, clientEntry(id)])),
  ssrModuleMapping: Object.fromEntries([...clientIds].map((id) => [id, { "*": clientEntry(id) }])),
  edgeSSRModuleMapping: {},
  rscModuleMapping: {},
  edgeRscModuleMapping: {},
  moduleLoading: { prefix: "", crossOrigin: null },
  entryCSSFiles: {},
  entryJSFiles: {},
};
write(join(distDir, "BUILD_ID"), "proofyard");
write(join(distDir, "routes-manifest.json"), {
  version: 3,
  caseSensitive: false,
  basePath: config.basePath,
  redirects: [],
  headers: [],
  rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
  dynamicRoutes: [],
  staticRoutes: [],
  dataRoutes: [],
});
write(join(distDir, "prerender-manifest.json"), { version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview });
write(join(distDir, "server/preview-props.json"), preview);
write(join(distDir, "build-manifest.json"), {
  polyfillFiles: [],
  rootMainFiles: ["static/chunks/main-app.js"],
  devFiles: [],
  lowPriorityFiles: [],
  pages: { "/_app": [] },
});
write(join(distDir, "server/next-font-manifest.json"), { pages: {}, app: {}, appUsingSizeAdjust: false, pagesUsingSizeAdjust: false });
const serverActionsManifest = {
  node: Object.fromEntries(
    [...actionFiles].map(([id, path]) => [
      id,
      {
        filename: relative(projectDir, path),
        workers: Object.fromEntries([...routes.values()].map(({ page }) => [`app${page}`, { moduleId: ACTION_FILE_PREFIX + path, async: false }])),
        layer: Object.fromEntries([...routes.values()].map(({ page }) => [`app${page}`, "rsc"])),
      },
    ]),
  ),
  edge: {},
  encryptionKey,
};
write(join(distDir, "server/server-reference-manifest.json"), serverActionsManifest);
write(join(distDir, "required-server-files.json"), { version: 1, config, appDir: projectDir, relativeAppDir: "", files: [], ignore: [] });
for (const { page } of routes.values()) {
  write(
    join(distDir, `server/app${page}_client-reference-manifest.js`),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST[${JSON.stringify(page)}] = ${JSON.stringify(clientReferenceManifest)};\n`,
  );
}

// リクエストの外（renderRSC / render）で描画するときの manifest。リクエストの処理中は Next.js 自身が設定し直す。
// クロージャの Server Action の値の暗号化（encryption.ts）がここから鍵を読む
require(rsc.get(facadeEntries.get(MANIFESTS_SINGLETON)!)!).default.setManifestsSingleton({
  page: "/_proofyard/page",
  clientReferenceManifest,
  serverActionsManifest,
});

// URL → ルート（Next.js のルート並び順と正規表現で照合）
const sorted: string[] = getSortedRoutes([...routes.keys()]);
const matchers = sorted.map((pathname) => ({ pathname, re: getRouteRegex(pathname).re as RegExp }));

export type RequestRouteOptions = {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: BodyInit | null;
};

// URL へのリクエストを Next.js 本体の handler で処理し、HTTP の応答を返す
async function requestRoute(url: string, init: RequestRouteOptions = {}): Promise<Response> {
  const pathname = new URL(url, "http://localhost").pathname;
  const match = matchers.find((m) => m.re.test(pathname));
  if (!match) throw new Error(`[proofyard] no route matches ${pathname}`);
  const { handler } = await import(rsc.get(routes.get(match.pathname)!.entry)!);
  // 本文と content-type（FormData の boundary など）は Request に作らせる
  const request = new Request(new URL(url, "http://localhost"), { method: init.method, headers: { host: "localhost", ...init.headers }, body: init.body });
  if (init.cookies) {
    const cookie = Object.entries(init.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    request.headers.set("cookie", [request.headers.get("cookie"), ...cookie].filter(Boolean).join("; "));
  }
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  const { req, res } = createRequestResponseMocks({ url, method: request.method, headers: Object.fromEntries(request.headers) });
  // MockedRequest の bodyReadable は、その _read を呼ぶだけで req にデータが流れない。本文は req 自身に流す
  if (body)
    req._read = function (this: import("node:stream").Readable) {
      this.push(body);
      this.push(null);
    };
  await handler(req, res, { requestMeta: { distDir, relativeProjectDir: relative(process.cwd(), projectDir), initURL: request.url } });
  await res.hasStreamed;
  const nullBody = [101, 204, 205, 304].includes(res.statusCode);
  return new Response(nullBody ? null : Buffer.concat(res.buffers), { status: res.statusCode, headers: res.headers });
}

// サーバー側の、テストのオリジン（http://localhost）への fetch はメモリ内の handler へ。
// Next.js は Server Action の redirect 先の RSC を自分自身に fetch して取る（action-handler.ts の createRedirectRenderResult）。
// Next.js の fetch のパッチ（patchFetch）より先に入れる
// ponytail: http://localhost（80 番）で本物のサーバーを動かすテストとはぶつかる。必要になったらオリジンを設定にする
const nativeFetch = globalThis.fetch;
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== "http://localhost") return nativeFetch(input, init);
  const response = await requestRoute(url.pathname + url.search, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: request.body ? await request.arrayBuffer() : undefined,
  });
  Object.defineProperty(response, "url", { value: url.href });
  return response;
}, nativeFetch);

// アプリのキャッシュ（"use cache" のハンドラーとタグの無効化記録）はテストごとに分離する。
// ハンドラーは次のリクエストで Next.js 自身が作り直す（use-cache/handlers.ts の initializeCacheHandlers）
const { tagsManifest } = require("next/dist/server/lib/incremental-cache/tags-manifest.external");
function resetCache() {
  const g = globalThis as any;
  if (g[Symbol.for("@next/cache-handlers")])
    throw new Error("[proofyard] Unsupported: custom cacheHandlers cannot be isolated between tests by the current runtime");
  for (const name of ["@next/cache-handlers-map", "@next/cache-handlers-set", "@next/cache-handlers-built-in"]) delete g[Symbol.for(name)];
  tagsManifest.clear();
}
// 無効化されたタグ（revalidateTag / updateTag / revalidatePath が記録したもの）
const invalidatedTags = (): string[] => [...tagsManifest.keys()];
const { afterEach, beforeEach } = await import("bun:test");
beforeEach(resetCache);
// テストごとに DOM を分離する（仕様 19 章）。render() の React のルートを外し（src/testing/render.ts）、body を空にする
afterEach(() => {
  // 先にフォーカスを外す（turbo-dom は取り除いた要素を activeElement に残す。ブラウザなら body に戻る）
  if (typeof document !== "undefined") (document.activeElement as HTMLElement | null)?.blur?.();
  (globalThis as any)[Symbol.for("proofyard.cleanup")]?.();
  (globalThis as any)[Symbol.for("proofyard.routeCleanup")]?.();
  if (typeof document !== "undefined") document.body.innerHTML = "";
});

// ブラウザ層（Client Mode）。使うときに初めてビルドする
// - Next.js のブラウザ向けの define（getDefineEnv の isClient）
// - Flight クライアントのモジュール読み込み（globalThis.__next_require__）を SSR と分ける
const BROWSER_RUNTIME = join(import.meta.dir, "../client/runtime.ts");
// ビルドはプリロードで済ませる。読み込み（評価）は最初の render() で DOM を入れた後（react-dom は読み込み時に window を見る）
// ブラウザ層のファイルの差し替え（create-compiler-aliases.ts の isClient のもの）
// - .browser の兄弟があるモジュールはそれに（サーバーの処理をブラウザのバンドルに入れない）
// - Instant Navigation Testing API を使わないなら navigation-testing-lock は無効版に
// - experimental.concurrentRouterQueue ならルーターの入口を concurrent の実装に
const nextDist = dirname(Bun.resolveSync("next/dist/server/next", process.cwd())).replace(/\/server$/, "");
const testingApiEnabled = !!config.cacheComponents && (dev || !!config.experimental.exposeTestingApiInProductionBuild);
const browserRedirect = (resolved: string): string | undefined => {
  if (!resolved.startsWith(nextDist + "/") || !resolved.endsWith(".js")) return undefined;
  const rel = resolved.slice(nextDist.length + 1, -".js".length);
  if (!testingApiEnabled && rel === "client/components/segment-cache/navigation-testing-lock")
    return join(nextDist, "client/components/segment-cache/navigation-testing-lock.disabled.js");
  if (config.experimental.concurrentRouterQueue) {
    if (rel === "client/components/navigator") return join(nextDist, "client/components/concurrent-router-queue.js");
    if (rel === "client/app-call-server") return join(nextDist, "client/concurrent-call-server.js");
  }
  const sibling = join(nextDist, `${rel}.browser.js`);
  return !rel.endsWith(".browser") && existsSync(sibling) ? sibling : undefined;
};
// Next.js のブラウザ向けの define
const clientDefine = Object.fromEntries(
  Object.entries(
    getDefineEnv({
      isTurbopack: false,
      config,
      dev,
      distDir,
      projectPath: projectDir,
      fetchCacheKeyPrefix: config.experimental.fetchCacheKeyPrefix,
      hasRewrites: false,
      isClient: true,
      isEdgeServer: false,
      isNodeServer: false,
      middlewareMatchers: undefined,
      rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
    }) as Record<string, unknown>,
  ).map(([k, v]) => [k, typeof v === "string" ? v : String(v)]),
);
let browserBuild: ReturnType<typeof buildLayer> | undefined;
const buildBrowser = () =>
  (browserBuild ??= buildLayer("browser", [...clientIds, BROWSER_RUNTIME], {
    transform: swcTransformFor("browser"),
    redirect: browserRedirect,
    define: {
      ...clientDefine,
      // React の act（Testing Library が使う）は開発版にしかないので、ブラウザ層の React だけ開発版にする（Jest などと同じ）。
      // Next.js 自身の他の define は本番のまま
      "process.env.NODE_ENV": '"development"',
      // ブラウザ用の Flight クライアントは webpack のランタイム（__webpack_require__ と __webpack_chunk_load__）でモジュールを読む
      __webpack_require__: "globalThis.__proofyardBrowserRequire",
      __webpack_chunk_load__: "globalThis.__proofyardBrowserChunkLoad",
      "globalThis.__next_require__": "globalThis.__proofyardBrowserRequire",
    },
  }));

// renderRoute の Client Mode: Next.js 本体のクライアント（app-next.js）と Client Component を 1 つのファイルにまとめる。
// renderRoute のたびにクエリ付きで import し直す（ルーターなどのモジュールの状態をテストごとに新しくする）。
// next build のブラウザ向けと同じく本番版（React も本番版なので act はない。表示は findBy / waitFor で待つ）
for (const name of ["instrumentation-client", "src/instrumentation-client"])
  for (const ext of pageExtensions)
    if (existsSync(join(projectDir, `${name}.${ext}`)))
      throw new Error(`[proofyard] Unsupported: ${name}.${ext} (client instrumentation) is not supported by renderRoute yet`);
const ROUTE_ENTRY = join(work, "route-entry.js");
write(
  ROUTE_ENTRY,
  [
    // webpack のランタイムの代わり（Flight クライアントが Client Reference のモジュールを読む）
    "const modules = {",
    ...[...clientIds].map((id) => `  ${JSON.stringify(id)}: () => require(${JSON.stringify(id)}),`),
    "};",
    "globalThis.__proofyardRouteRequire = Object.assign((id) => {",
    "  if (!(id in modules)) throw new Error(`[proofyard] unknown client module ${id}`);",
    "  return modules[id]();",
    "}, { u: (chunkId) => chunkId });",
    "globalThis.__proofyardRouteChunkLoad = () => Promise.resolve();",
    `require(${JSON.stringify(join(nextDist, "client/app-next.js"))});`,
  ].join("\n"),
);
const routeBuild = buildLayer("browser", [ROUTE_ENTRY], {
  transform: swcTransformFor("route"),
  redirect: browserRedirect,
  splitting: false,
  aliases: {
    "react-dom/test-utils": undefined,
    "next/dist/client/app-call-server": undefined,
    "react-server-dom-webpack/client": "next/dist/compiled/react-server-dom-webpack/client",
    "react-dom/client": join(import.meta.dir, "../client/route-react-dom-client.ts"),
    "private-next-instrumentation-client": join(import.meta.dir, "../client/no-instrumentation-client.js"),
  },
  define: {
    ...clientDefine,
    __webpack_require__: "globalThis.__proofyardRouteRequire",
    __webpack_chunk_load__: "globalThis.__proofyardRouteChunkLoad",
    "globalThis.__next_require__": "globalThis.__proofyardRouteRequire",
    // クライアントの通信（RSC の取得、Server Actions）はメモリ内の Next.js の handler へ（src/testing/render-route.ts）
    fetch: "globalThis.__proofyardRouteFetch",
    // ハイドレーションの完了を window.__NEXT_HYDRATED_CB で知らせる（Next.js 自身のテストと同じ）
    "process.env.__NEXT_TEST_MODE": "true",
  },
}).then((outputs) => outputs.get(ROUTE_ENTRY)!);
let browser: Promise<typeof import("../client/runtime")> | undefined;
const loadBrowser = () =>
  (browser ??= (async () => {
    const outputs = await buildBrowser();
    const modules = new Map<string, unknown>();
    // バンドルのモジュールを評価する前に用意する（Flight クライアントが読み込み時に __webpack_require__.u を書き換える）
    // モジュールは Flight で参照されたときに初めて評価する（webpack と同じ。App Router の内部のもの（layout-router など）は
    // ルーターなしでは評価できないので、使われない限り読まない）
    (globalThis as any).__proofyardBrowserRequire = Object.assign(
      (id: string) => {
        if (!modules.has(id)) {
          const out = outputs.get(id);
          if (!out) throw new Error(`[proofyard] unknown client module ${id}`);
          const m = require(out);
          modules.set(id, esmClientIds.has(id) ? m : m.default);
        }
        return modules.get(id);
      },
      { u: (chunkId: string) => chunkId },
    );
    // Client Reference のチャンクは空なので呼ばれない
    (globalThis as any).__proofyardBrowserChunkLoad = () => Promise.resolve();
    return import(outputs.get(BROWSER_RUNTIME)!);
  })());

const ssrRuntime = (): typeof import("./ssr-runtime") => ssrModules.get(SSR_RUNTIME) as any;
// SSR 層の Flight デコードの moduleMap（Client Reference の id → SSR 層のモジュール）
const ssrModuleMap = () => Object.fromEntries([...clientIds].map((id) => [id, { "*": { id, name: "*", chunks: [], async: false } }]));

// テストが始まる前にビルドを終える（最初の render() のテストがビルドの時間でタイムアウトしないように）
await Promise.all([buildBrowser(), routeBuild]);
console.log(`[proofyard] browser layer: ${(performance.now() - t).toFixed(0)}ms`);
(globalThis as any)[Symbol.for("proofyard.next")] = { requestRoute, invalidatedTags, loadBrowser, ssrRuntime, ssrModuleMap, routeBundle: () => routeBuild } satisfies NextHarness;
export type NextHarness = {
  requestRoute: typeof requestRoute;
  invalidatedTags: typeof invalidatedTags;
  loadBrowser: typeof loadBrowser;
  ssrRuntime: typeof ssrRuntime;
  ssrModuleMap: typeof ssrModuleMap;
  // renderRoute の Client Mode のバンドル（ファイルのパス）
  routeBundle: () => Promise<string>;
};
