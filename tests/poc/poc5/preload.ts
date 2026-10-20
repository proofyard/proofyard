// PoC 5: Next.js App Router のアプリを、Next.js 本体の実装でビルド（層ごと）してリクエストを処理する。
// - ルートツリーとエントリ: next-app-loader（next build と同じ生成コード）
// - 設定: loadConfig、manifest: `next start` と同じ形の .next を一時ディレクトリに書く
// - リクエスト処理: エントリの handler（app-page テンプレート）
require("next/dist/server/node-environment-baseline"); // globalThis.AsyncLocalStorage
// Next.js の runtime バンドル（vendored React を含む）。層をまたいで共有する
require("next/dist/server/route-modules/app-page/module.compiled");
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildLayer, clientIds, esmClientIds } from "./layers";

// ponytail: 対象アプリは環境変数で受け取る。設定（proofyard.config 等）は Phase 2 の CLI で
const projectDir = resolve(process.env.PROOFYARD_NEXT_APP ?? join(import.meta.dir, "fixture-app"));
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
const { transform } = require("next/dist/build/swc");
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
const swcTransform = async (filename: string, source: string) => {
  if (!filename.startsWith(projectDir + "/")) return undefined;
  const options = getLoaderSWCOptions({
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
  const out = await transform(source, { ...options, filename, sourceFileName: filename });
  return out.code as string;
};
const rsc = await buildLayer("rsc", [...routes.values()].map((r) => r.entry), { define, generatedDir, transform: swcTransform });
const ssr = await buildLayer("ssr", [...clientIds], { define });
console.log(`[proofyard] rsc+ssr layers: ${(performance.now() - t).toFixed(0)}ms, client references: ${clientIds.size}`);

// SSR 層の Client Component（webpack の require と同じく CJS は module.exports、ESM は名前空間）
const ssrModules = new Map<string, unknown>();
for (const [id, out] of ssr) {
  const m = await import(out);
  ssrModules.set(id, esmClientIds.has(id) ? m : m.default);
}
(globalThis as any).__proofyardNextRequire = (id: string) => {
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

export type NextResponseResult = { status: number; headers: Headers; html: string };

async function request(url: string, init: { headers?: Record<string, string>; method?: string } = {}): Promise<NextResponseResult> {
  const pathname = new URL(url, "http://localhost").pathname;
  const match = matchers.find((m) => m.re.test(pathname));
  if (!match) throw new Error(`[proofyard] no route matches ${pathname}`);
  const { handler } = await import(rsc.get(routes.get(match.pathname)!.entry)!);
  const { req, res } = createRequestResponseMocks({ url, method: init.method, headers: { host: "localhost", ...init.headers } });
  await handler(req, res, { requestMeta: { distDir, relativeProjectDir: relative(process.cwd(), projectDir) } });
  await res.hasStreamed;
  return { status: res.statusCode, headers: res.headers, html: Buffer.concat(res.buffers).toString("utf8") };
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

(globalThis as any).__proofyardNext = { request, invalidatedTags };
