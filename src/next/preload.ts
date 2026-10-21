// Next.js モードのプリロード: App Router のアプリを、Next.js 本体の実装でビルド（層ごと）してリクエストを処理する。
// - ルートとエントリ: discoverRoutes / createEntrypoints と各ローダー（next build と同じ生成コード）
// - 設定: loadConfig、manifest: `next start` と同じ形の .next を一時ディレクトリに書く
// - リクエスト処理: next start と同じ router-server（Proxy、next.config の redirects / rewrites / headers を含む）
require("next/dist/server/node-environment-baseline"); // globalThis.AsyncLocalStorage
// Next.js の runtime バンドル（vendored React を含む）。層をまたいで共有する
require("next/dist/server/route-modules/app-page/module.compiled");
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { actionModule, serverActions } from "../testing/actions";
import { ALIASES, BUNDLED_ALIASES, USE_CLIENT, buildLayer, clientIds, clientReferenceStub, esmClientIds } from "./layers";

// 対象アプリ（next.config と app/ のあるディレクトリ）。既定は bun test を実行したディレクトリ
// ponytail: 環境変数で受け取る。設定ファイル（proofyard.config 等）は必要になったら
const projectDir = resolve(process.env.PROOFYARD_NEXT_APP ?? process.cwd());
const work = join(tmpdir(), `proofyard-next-${process.pid}`);
// 前の実行の生成物のうち、afterAll まで行かなかったもの（プリロードの Fail Closed など）を消す
for (const name of readdirSync(tmpdir())) {
  const pid = Number(name.match(/^proofyard-next-(\d+)$/)?.[1]);
  if (!pid) continue;
  try {
    process.kill(pid, 0); // まだ動いているプロセスのもの
  } catch {
    rmSync(join(tmpdir(), name), { recursive: true, force: true });
  }
}
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
const { createRequestResponseMocks } = require("next/dist/server/lib/mock-request");
const { getDefineEnv } = require("next/dist/build/define-env");
const { transformSync } = require("next/dist/build/swc");
const { getLoaderSWCOptions } = require("next/dist/build/swc/options");
const { default: loadCustomRoutes } = require("next/dist/lib/load-custom-routes");
const { default: nextMiddlewareLoader } = require("next/dist/build/webpack/loaders/next-middleware-loader");
const { discoverRoutes, createPagesMapping } = require("next/dist/build/route-discovery");
const { createEntrypoints } = require("next/dist/build/entries");
const { generateInterceptionRoutesRewrites } = require("next/dist/lib/generate-interception-routes-rewrites");
const querystring = require("node:querystring");
const { generateRoutesManifest } = require("next/dist/build/generate-routes-manifest");

let t = performance.now();
const config = await loadConfig(PHASE_PRODUCTION_BUILD, projectDir, { silent: true });
const pageExtensions: string[] = config.pageExtensions;
// app/ か src/app/（next build と同じ findPagesDir）
const { appDir, pagesDir } = require("next/dist/lib/find-pages-dir").findPagesDir(projectDir) as { appDir?: string; pagesDir?: string };
if (pagesDir) throw new Error(`[proofyard] Unsupported Next.js feature: the Pages Router (${pagesDir})`);
if (!appDir) throw new Error(`[proofyard] no app directory in ${projectDir}`);
const isSrcDir = relative(projectDir, appDir).startsWith("src");

// next build と同じルートの発見とエントリ（build/index.ts の discoverRoutes / createPagesMapping / createEntrypoints）
// - app/ のページ・Route Handler と、組み込みの _not-found / _global-error: next-app-loader
// - Proxy（proxy.ts / middleware.ts）: next-middleware-loader
const customRoutes = await loadCustomRoutes(config);
// Proxy などのファイルは app/ の親（src/ を使うなら src/）にある。パスはプロジェクトからの "/src/proxy.ts" の形
const ROOT_FILE = new RegExp(`^(?:proxy|middleware|instrumentation)\\.(?:${pageExtensions.join("|")})$`);
const rootDir = dirname(appDir);
const rootPaths = readdirSync(rootDir)
  .filter((file) => ROOT_FILE.test(file))
  .map((file) => "/" + relative(projectDir, join(rootDir, file)));
const rootFile = (name: string) => rootPaths.some((path) => path.slice(path.lastIndexOf("/") + 1).startsWith(`${name}.`));
if (rootFile("proxy") && rootFile("middleware"))
  throw new Error('[proofyard] Both "middleware" and "proxy" files are detected. Please use "proxy" only (same as next build)');
const discovery = await discoverRoutes({ appDir, pageExtensions, isDev: false, baseDir: projectDir, isSrcDir, appDirOnly: true });
// next build と同じく、ページの一覧（URL の形）と Intercepting Routes の rewrite（beforeFiles）
const appPaths = [...new Set(Object.keys(discovery.mappedAppPages).map((page) => normalizeAppPath(page)))];
customRoutes.rewrites.beforeFiles.push(...generateInterceptionRoutesRewrites(appPaths, config.basePath));
const entrypoints = await createEntrypoints({
  buildId: "proofyard",
  config,
  envFiles: [],
  isDev: false,
  pages: discovery.mappedPages ?? {},
  rootDir: projectDir,
  rootPaths: await createPagesMapping({ isDev: false, pageExtensions, pagePaths: rootPaths, pagesType: "root", appDir, appDirOnly: true }),
  appDir,
  appPaths: discovery.mappedAppPages,
  appDefaultPaths: discovery.mappedAppDefaults,
  pageExtensions,
  previewMode: {},
  hasInstrumentationHook: rootFile("instrumentation"),
});
if (Object.keys(entrypoints.edgeServer).length > 0)
  throw new Error(`[proofyard] Unsupported Next.js feature: the edge runtime (${Object.keys(entrypoints.edgeServer).join(", ")})`);
const middlewareMatchers = entrypoints.middlewareMatchers;
// webpack と同じく、ローダーのオプションはクエリ文字列（getOptions は querystring.parse）
const LOADERS: Record<string, Function> = { "next-app-loader": nextAppLoader, "next-middleware-loader": nextMiddlewareLoader };
const routes = new Map<string, { page: string; entry: string }>(); // pathname → エントリ
let middlewareEntry: string | undefined;
let instrumentationEntry: string | undefined;
for (const [i, [name, value]] of Object.entries(entrypoints.server as Record<string, string | { import: string; layer?: string }>).entries()) {
  // instrumentation はローダーを通さず、ファイルそのもの（getInstrumentationEntry。Proxy と同じ react-server の層）
  if (typeof value === "object" && value.layer === "instrument") {
    instrumentationEntry = join(generatedDir, `${i}.js`);
    write(instrumentationEntry, `export * from ${JSON.stringify(value.import.replace(/^private-next-root-dir\//, `${projectDir}/`))};\n`);
    continue;
  }
  const request = typeof value === "string" ? value : value.import;
  const [, loader, query] = request.match(/^([^?!]+)\?(.*)!$/) ?? [];
  if (!loader || !LOADERS[loader]) throw new Error(`[proofyard] Unsupported Next.js entry: ${name} (${request})`);
  const options = querystring.parse(query!);
  const code: string = await LOADERS[loader]!.call({
    getOptions: () => options,
    context: projectDir,
    rootContext: projectDir,
    utils: { contextify: (context: string, request: string) => (request.startsWith("/") ? `./${relative(context, request)}` : request) },
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
      .replace("const __next_app_require__ = __webpack_require__", "const __next_app_require__ = (id) => globalThis.__proofyardNextRequire(id)")
      // webpack の resolve.alias（private-next-root-dir → プロジェクト）
      .replace(/(["'])private-next-root-dir\//g, `$1${projectDir}/`),
  );
  if (loader === "next-middleware-loader") middlewareEntry = entry;
  else routes.set(normalizeAppPath(options.page as string), { page: options.page as string, entry });
}
console.log(`[proofyard] entries: ${routes.size} routes${middlewareEntry ? " + proxy" : ""}${instrumentationEntry ? " + instrumentation" : ""} ${(performance.now() - t).toFixed(0)}ms`);

t = performance.now();
// next build と同じ define（nodejs のサーバー。bun test の NODE_ENV=test は production 扱い）
const hasRewrites = Object.values(customRoutes.rewrites as Record<string, unknown[]>).some((r) => r.length > 0);
const nextDefine: Record<string, unknown> = getDefineEnv({
  isTurbopack: false,
  config,
  dev: process.env.NODE_ENV === "development",
  distDir,
  projectPath: projectDir,
  fetchCacheKeyPrefix: config.experimental.fetchCacheKeyPrefix,
  hasRewrites,
  isClient: false,
  isEdgeServer: false,
  isNodeServer: true,
  middlewareMatchers,
  rewrites: customRoutes.rewrites,
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
// tsconfig / jsconfig（Next.js と同じ loadJsConfig。paths の解決は webpack では JsConfigPathsPlugin、ここでは Bun の tsconfig の対応）
const jsConfig = (await require("next/dist/build/load-jsconfig").default(projectDir, config)).jsConfig ?? { compilerOptions: {} };
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
const entries = [...routes.values()].map((r) => r.entry).concat(middlewareEntry ?? [], instrumentationEntry ?? []);

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
// ルートの一覧と next.config の redirects / rewrites / headers（next build と同じ生成処理。build/index.ts）
const { routesManifest } = generateRoutesManifest({
  appType: "app",
  pageKeys: { pages: [], app: appPaths },
  config,
  redirects: customRoutes.redirects,
  headers: customRoutes.headers,
  onMatchHeaders: customRoutes.onMatchHeaders,
  rewrites: customRoutes.rewrites,
  restrictedRedirectPaths: ["/_next"].map((p) => (config.basePath ? `${config.basePath}${p}` : p)),
  isAppPPREnabled: !!config.cacheComponents,
  deploymentId: config.deploymentId,
});
write(join(distDir, "routes-manifest.json"), routesManifest);
// ページのモジュール（next start は server/app/<page>.js を require する）は rsc 層のビルド結果
write(join(distDir, "server/app-paths-manifest.json"), Object.fromEntries([...routes.values()].map(({ page }) => [page, `app${page}.js`])));
write(join(distDir, "app-path-routes-manifest.json"), Object.fromEntries([...routes].map(([pathname, { page }]) => [page, pathname])));
for (const { page, entry } of routes.values()) write(join(distDir, `server/app${page}.js`), `module.exports = require(${JSON.stringify(rsc.get(entry))});\n`);
write(join(distDir, "server/pages-manifest.json"), {});
mkdirSync(join(distDir, "static"), { recursive: true });
write(join(distDir, "server/middleware-manifest.json"), { version: 3, middleware: {}, functions: {}, sortedMiddleware: [] });
// Node.js の Proxy は server/middleware.js（next-server.ts の loadNodeMiddleware）。matcher は functions-config-manifest に
write(
  join(distDir, "server/functions-config-manifest.json"),
  { version: 1, functions: middlewareEntry ? { "/_middleware": { runtime: "nodejs", matchers: middlewareMatchers } } : {} },
);
if (middlewareEntry) write(join(distDir, "server/middleware.js"), `module.exports = require(${JSON.stringify(rsc.get(middlewareEntry))});\n`);
// instrumentation は server/instrumentation.js（getInstrumentationModule）。register / onRequestError は Next.js 本体が呼ぶ
if (instrumentationEntry) write(join(distDir, "server/instrumentation.js"), `module.exports = require(${JSON.stringify(rsc.get(instrumentationEntry))});\n`);
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

export type RequestRouteOptions = {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: BodyInit | null;
};

// URL へのリクエストを Next.js 本体のルーター（next start と同じ router-server）で処理し、HTTP の応答を返す
async function requestRoute(url: string, init: RequestRouteOptions = {}): Promise<Response> {
  const handler = await getRouter();
  // 本文と content-type（FormData の boundary など）は Request に作らせる
  const request = new Request(new URL(url, "http://localhost"), { method: init.method, headers: { host: "localhost", ...init.headers }, body: init.body });
  if (init.cookies) {
    const cookie = Object.entries(init.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    request.headers.set("cookie", [request.headers.get("cookie"), ...cookie].filter(Boolean).join("; "));
  }
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  // 本文はストリームで返す（ブラウザと同じく、Suspense の fallback などが先に届く）。
  // ステータスとヘッダーは、Node.js と同じく最初の書き込み（または終わり）の時点のもの
  const head = Promise.withResolvers<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  let written = false;
  const { req, res } = createRequestResponseMocks({
    url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    resWriter: (chunk: Uint8Array | string) => {
      written = true;
      head.resolve();
      controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk));
      return true;
    },
  });
  // MockedRequest の bodyReadable は、その _read を呼ぶだけで req にデータが流れない。本文は req 自身に流す
  if (body)
    req._read = function (this: import("node:stream").Readable) {
      this.push(body);
      this.push(null);
    };
  let failure: { error: unknown } | undefined;
  handler(req, res)
    .then(() => res.hasStreamed)
    .then(
      () => controller.close(),
      (error) => {
        failure = { error };
        controller.error(error);
      },
    )
    .finally(head.resolve);
  await head.promise;
  if (failure && !written) throw failure.error;
  const nullBody = [101, 204, 205, 304].includes(res.statusCode);
  return new Response(nullBody ? null : stream, { status: res.statusCode, headers: res.headers });
}

// next start のルーター（Proxy、next.config の redirects / rewrites / headers、ルートの解決）
let router: Promise<(req: unknown, res: unknown) => Promise<void>> | undefined;
const getRouter = () =>
  (router ??= (async () => {
    const { initialize } = require("next/dist/server/lib/router-server");
    // 設定は読み込み済みのものを渡す（distDir は一時ディレクトリ。standalone の server.js と同じ仕組み）
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify({ ...config, distDir: relative(projectDir, distDir) });
    try {
      const { requestHandler } = await initialize({ dir: projectDir, port: 80, hostname: "localhost", dev: false, minimalMode: false, quiet: false, onDevServerCleanup: undefined });
      return requestHandler;
    } finally {
      delete process.env.__NEXT_PRIVATE_STANDALONE_CONFIG;
    }
  })());

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
const { afterAll, afterEach, beforeEach } = await import("bun:test");
// 生成物（エントリ、層のビルド、.next）は全テストの後に消す（layers.ts の出力もこの下）。bun test は process の exit を出さない
afterAll(() => rmSync(work, { recursive: true, force: true }));
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
      hasRewrites,
      isClient: true,
      isEdgeServer: false,
      isNodeServer: false,
      middlewareMatchers,
      rewrites: customRoutes.rewrites,
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
