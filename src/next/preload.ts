// Next.js モードのプリロード: App Router のアプリを、Next.js 本体の実装でビルド（層ごと）してリクエストを処理する。
// - ルートツリーとエントリ: next-app-loader（next build と同じ生成コード）
// - 設定: loadConfig、manifest: `next start` と同じ形の .next を一時ディレクトリに書く
// - リクエスト処理: エントリの handler（app-page テンプレート）
require("next/dist/server/node-environment-baseline"); // globalThis.AsyncLocalStorage
// Next.js の runtime バンドル（vendored React を含む）。層をまたいで共有する
require("next/dist/server/route-modules/app-page/module.compiled");
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
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
const { transform, transformSync } = require("next/dist/build/swc");
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
const dev = process.env.NODE_ENV === "development";
const jsConfig = { compilerOptions: {} }; // ponytail: tsconfig の paths / baseUrl は未対応（Next.js は loadJsConfig で読む）
const swcOptions = (filename: string) =>
  getLoaderSWCOptions({
    filename,
    development: dev,
    isServer: true,
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
    bundleLayer: "rsc",
    esm: true,
    cacheHandlers: config.cacheHandlers,
    useCacheEnabled: config.experimental.useCache,
    taintEnabled: config.experimental.taint,
    trackDynamicImports: !!config.cacheComponents,
    pageExtensions,
  });
// アプリのソース（プロジェクト内の node_modules 以外）
const isAppSource = (path: string) => path.startsWith(projectDir + "/") && !path.includes("/node_modules/");
const swcTransform = async (filename: string, source: string) =>
  isAppSource(filename)
    ? ((await transform(source, { ...swcOptions(filename), filename, sourceFileName: filename })).code as string)
    : undefined;
// ネイティブ読み込み用は同期（非同期の onLoad を経たモジュールは require できない。route.ts は require で読まれる）
const swcTransformSync = (filename: string, source: string): string =>
  transformSync(source, { ...swcOptions(filename), filename, sourceFileName: filename }).code;
const entries = [...routes.values()].map((r) => r.entry);
// 1 回目: アプリも含めて rsc 層をバンドルし、Client Reference（SSR 層に入れるもの）を集める
// ponytail: 収集のためだけのバンドル。import グラフの走査で置き換えられる
await buildLayer("rsc", entries, { define, generatedDir, transform: swcTransform });
for (const id of clientIds)
  if (id.includes("/node_modules/") && !id.includes("/node_modules/next/"))
    throw new Error(`[proofyard] Unsupported: "use client" modules in node_modules are not supported yet (${id})`);
const ssr = await buildLayer("ssr", [...clientIds], { define });
// 2 回目: Next.js 本体だけをバンドルし、アプリはネイティブで読み込む（mock.module が効く）
// アプリが import しうる Next.js 本体のモジュール（next/cache などの公開の入口、SWC が出力する private-next-rsc-* など）も
// 同じバンドルの入口にする。ネイティブで読むと define が効かず（NODE_ENV など）、本番と違うコードが動くため
const nextFacades = new Map<string, string>(); // 指定子 → ファイル
for (const [spec, target] of Object.entries(BUNDLED_ALIASES.rsc)) nextFacades.set(spec, Bun.resolveSync(target, process.cwd()));
// App Router の公開の入口（Pages Router 専用のもの（next/document など）は rsc 層では使わない）
// ponytail: 一覧にない next/* をネイティブで読むと define が効かない。必要になったら一覧に足す
const APP_ROUTER_ENTRIES = ["cache", "headers", "server", "image", "script", "og", "root-params", "constants"];
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
const facadeEntries = new Map<string, string>(); // ファイル → 入口
for (const file of new Set(nextFacades.values())) {
  const entry = join(generatedDir, `facade-${facadeEntries.size}.mjs`);
  write(entry, `import * as m from ${JSON.stringify(file)};\nexport default m;\n`);
  facadeEntries.set(file, entry);
}
const rsc = await buildLayer("rsc", [...entries, ...facadeEntries.values()], { define, generatedDir, nativeDir: projectDir });

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
        return { exports: { ...cjs, ...m }, loader: "object" };
      });
    build.onLoad({ filter: new RegExp(`^${escape(projectDir)}/(?!.*/node_modules/).*\\.[jt]sx?$`) }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (USE_CLIENT.test(source)) return { contents: clientReferenceStub(args.path, source), loader: "js" };
      return { contents: swcTransformSync(args.path, source), loader: "js" };
    });
  },
});
console.log(`[proofyard] rsc+ssr layers: ${(performance.now() - t).toFixed(0)}ms, client references: ${clientIds.size}`);

// SSR 層の Client Component（webpack の require と同じく CJS は module.exports、ESM は名前空間）
const ssrModules = new Map<string, unknown>();
for (const [id, out] of ssr) {
  const m = await import(out);
  ssrModules.set(id, esmClientIds.has(id) ? m : m.default);
}
(globalThis as any).__proofyardNextRequire = (id: string) => {
  // renderRSC の Client Reference（実行しない代わりのモジュール。src/testing/render-rsc.ts）
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
write(join(distDir, "server/server-reference-manifest.json"), { node: {}, edge: {}, encryptionKey });
write(join(distDir, "required-server-files.json"), { version: 1, config, appDir: projectDir, relativeAppDir: "", files: [], ignore: [] });
for (const { page } of routes.values()) {
  write(
    join(distDir, `server/app${page}_client-reference-manifest.js`),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST[${JSON.stringify(page)}] = ${JSON.stringify(clientReferenceManifest)};\n`,
  );
}

// URL → ルート（Next.js のルート並び順と正規表現で照合）
const sorted: string[] = getSortedRoutes([...routes.keys()]);
const matchers = sorted.map((pathname) => ({ pathname, re: getRouteRegex(pathname).re as RegExp }));

export type RequestRouteOptions = {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
};

// URL へのリクエストを Next.js 本体の handler で処理し、HTTP の応答を返す
async function requestRoute(url: string, init: RequestRouteOptions = {}): Promise<Response> {
  const pathname = new URL(url, "http://localhost").pathname;
  const match = matchers.find((m) => m.re.test(pathname));
  if (!match) throw new Error(`[proofyard] no route matches ${pathname}`);
  const { handler } = await import(rsc.get(routes.get(match.pathname)!.entry)!);
  const headers: Record<string, string> = { host: "localhost", ...init.headers };
  if (init.cookies) {
    const cookie = Object.entries(init.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    headers.cookie = [headers.cookie, ...cookie].filter(Boolean).join("; ");
  }
  const { req, res } = createRequestResponseMocks({ url, method: init.method, headers });
  await handler(req, res, { requestMeta: { distDir, relativeProjectDir: relative(process.cwd(), projectDir) } });
  await res.hasStreamed;
  const nullBody = [101, 204, 205, 304].includes(res.statusCode);
  return new Response(nullBody ? null : Buffer.concat(res.buffers), { status: res.statusCode, headers: res.headers });
}

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
const { beforeEach } = await import("bun:test");
beforeEach(resetCache);

(globalThis as any)[Symbol.for("proofyard.next")] = { requestRoute, invalidatedTags } satisfies NextHarness;
export type NextHarness = {
  requestRoute: typeof requestRoute;
  invalidatedTags: typeof invalidatedTags;
};
