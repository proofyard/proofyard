// Next.js モードのプリロード: App Router のアプリを、Next.js 本体の実装でビルド（層ごと）してリクエストを処理する。
// - ルートとエントリ: discoverRoutes / createEntrypoints と各ローダー（next build と同じ生成コード）
// - 設定: loadConfig、manifest: `next start` と同じ形の .next を一時ディレクトリに書く
// - リクエスト処理: next start と同じ router-server（Proxy、next.config の redirects / rewrites / headers を含む）
/* oxlint-disable unicorn/prefer-module, node/global-require -- Next.js 本体の内部（CJS）を、条件付き・同期で、この順に読み込む */
/* oxlint-disable typescript/no-explicit-any -- 型のない Next.js 本体の内部とのやりとり */
/* oxlint-disable typescript/no-non-null-assertion -- 前の処理で必ずある値（実行時の検査を足すと失敗のしかたが変わる） */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFile,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
// oxlint-disable-next-line unicorn/import-style -- 関数を名前で多く使う（path は変数名に使っている）
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import type { Readable } from "node:stream";

import type * as ClientRuntime from "../client/runtime";
import { actionModule, serverActions } from "../testing/actions";
import type { ActionCall, ServerActionFunction } from "../testing/actions";
import { FONT_IMPORT, STYLE_FILE, createStyleLoader, unquote } from "./css";
import { unitCache } from "./layer-cache";
import {
  ALIASES,
  BUNDLED_ALIASES,
  SERVER_DIRECTIVE,
  USE_CLIENT,
  buildLayer,
  cjsExportNames,
  clientExports,
  clientIds,
  clientReferenceStub,
  esmClientIds,
} from "./layers";
import type * as SsrRuntime from "./ssr-runtime";

// 仕様 24.2: 確かめた範囲だけ動かす（Next.js 本体の内部のモジュールを直接使うので、版が違うと分かりにくい壊れ方をする）。
// 範囲は package.json の peerDependencies（パッチ版まで。マイナー版は内部のモジュールが変わることがある）
const SUPPORTED_NEXT: string =
  require("../../package.json").peerDependencies.next;
const nextVersion: string = require("next/package.json").version;

if (!Bun.semver.satisfies(nextVersion, SUPPORTED_NEXT)) {
  throw new Error(
    `[proofyard] Unsupported: Next.js ${nextVersion}. Supported versions: ${SUPPORTED_NEXT}`
  );
}
if (!Bun.version.startsWith("1.4.")) {
  throw new Error(
    `[proofyard] Unsupported: Bun ${Bun.version}. Supported versions: 1.4.x`
  );
}
// globalThis.AsyncLocalStorage
require("next/dist/server/node-environment-baseline");
// Next.js の runtime バンドル（vendored React を含む）。層をまたいで共有する
require("next/dist/server/route-modules/app-page/module.compiled");

// 対象アプリ（next.config と app/ のあるディレクトリ）。既定は bun test を実行したディレクトリ
// ponytail: 環境変数で受け取る。設定ファイル（proofyard.config 等）は必要になったら
// 実パスにする。Bun（Bun.build の出力・モジュールのパス）はシンボリックリンクを解決したパスを使うので、前方一致の比較が外れる
// （macOS の既定の TMPDIR /var/folders/... は /private/var/... へのシンボリックリンク）
const projectDir = realpathSync(
  resolve(process.env.PROOFYARD_NEXT_APP ?? process.cwd())
);
const tmp = realpathSync(tmpdir());
const work = join(tmp, `proofyard-next-${process.pid}`);
// 前の実行（終わったプロセス）の生成物を消す
for (const name of readdirSync(tmp)) {
  const pid = Number(
    name.match(/^proofyard-(?:next|run)-(?<pid>\d+)$/u)?.groups?.pid
  );
  if (!pid) {
    continue;
  }
  try {
    // まだ動いているプロセスのもの
    process.kill(pid, 0);
  } catch {
    rmSync(join(tmp, name), { force: true, recursive: true });
  }
}
const generatedDir = join(work, "entries");
const distDir = join(work, "dist");
const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
};

const {
  default: nextAppLoader,
} = require("next/dist/build/webpack/loaders/next-app-loader/index.js");
const { default: loadConfig } = require("next/dist/server/config");
const {
  PHASE_PRODUCTION_BUILD,
  PREFETCH_HINTS,
} = require("next/dist/shared/lib/constants");
const {
  normalizeAppPath,
} = require("next/dist/shared/lib/router/utils/app-paths");
const {
  createRequestResponseMocks,
} = require("next/dist/server/lib/mock-request");
const { getDefineEnv } = require("next/dist/build/define-env");
const { transformSync } = require("next/dist/build/swc");
const { getLoaderSWCOptions } = require("next/dist/build/swc/options");
const {
  default: loadCustomRoutes,
} = require("next/dist/lib/load-custom-routes");
const {
  default: nextMiddlewareLoader,
} = require("next/dist/build/webpack/loaders/next-middleware-loader");
const {
  default: nextMetadataRouteLoader,
} = require("next/dist/build/webpack/loaders/next-metadata-route-loader");
const {
  default: nextMetadataImageLoader,
} = require("next/dist/build/webpack/loaders/next-metadata-image-loader");
const { getModuleNamedExports } = require("next/dist/build/swc");
const {
  discoverRoutes,
  createPagesMapping,
} = require("next/dist/build/route-discovery");
const { createEntrypoints } = require("next/dist/build/entries");
const {
  generateInterceptionRoutesRewrites,
} = require("next/dist/lib/generate-interception-routes-rewrites");
const querystring = require("node:querystring");
const {
  generateRoutesManifest,
} = require("next/dist/build/generate-routes-manifest");

let t = performance.now();
const config = await loadConfig(PHASE_PRODUCTION_BUILD, projectDir, {
  silent: true,
});

// next build の prerender の結果（server/prefetch-hints.json と prerender-manifest.json）。prefetch hints はクライアントが静的な先読みを
// 試すか、どこを先読みしないか。next build は prerender のときに Next.js 本体（collectPrefetchHints）で求める。next build と同じく別のプロセスで、
// このプリロードを静的なページの prerender（exportApp）だけのために動かして求める（collectBuildOutput）。アプリのコードの副作用はテストのプロセスに残らない。
// Next.js は manifest を読んだ結果（無いことも）をランタイムのバンドルの中に覚えるので、同じプロセスでは prerender の後に読み直させられない
const BUILD_OUTPUT = process.env.PROOFYARD_BUILD_OUTPUT;
// 起動時間の内訳は PROOFYARD_DEBUG を付けたときだけ出す
const debug = !!process.env.PROOFYARD_DEBUG;
// bun test --parallel のワーカーどうしは、同じ実行（親のプロセス）の中で 1 回だけ作って共有する（next build も 1 回）。
// 最初のワーカーが作り、他のワーカーはその結果（失敗も）を待つ
// prerender の別プロセスは、それを動かしたプロセスの結果（層のビルドと node_modules を辿った結果）を待って使う
// （--parallel でなければ実行ごとに作る。bun test --watch は同じプロセスでプリロードをやり直すので、前の実行の結果を消す）
if (!BUILD_OUTPUT && !process.env.BUN_TEST_WORKER_ID) {
  for (const name of existsSync(work) ? readdirSync(work) : []) {
    if (name.startsWith("run-")) {
      rmSync(join(work, name), { force: true, recursive: true });
    }
  }
}
const runDir = (() => {
  if (BUILD_OUTPUT) {
    return process.env.PROOFYARD_RUN_DIR!;
  }
  if (process.env.BUN_TEST_WORKER_ID) {
    return join(tmp, `proofyard-run-${process.ppid}`);
  }
  return join(work, `run-${Date.now()}`);
})();
const leader = (() => {
  if (BUILD_OUTPUT) {
    return false;
  }
  try {
    mkdirSync(runDir, { recursive: !process.env.BUN_TEST_WORKER_ID });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    return false;
  }
})();
// 最初のワーカーが runDir に書いた結果（name.json か、失敗なら name.error）を待つ
// （結果を書くプロセスが先に終わったら、待たずに失敗する）
const parentPid = process.ppid;
const waitForLeader = async (name: string) => {
  const [output, failure] = [
    join(runDir, `${name}.json`),
    join(runDir, `${name}.error`),
  ];
  while (!existsSync(output) && !existsSync(failure)) {
    if (process.ppid !== parentPid) {
      throw new Error(`[proofyard] the process that builds ${name} has exited`);
    }
    // oxlint-disable-next-line no-await-in-loop -- 結果のファイルができるまで間をおいて確かめる
    await Bun.sleep(50);
  }
  if (existsSync(failure)) {
    throw new Error(readFileSync(failure, "utf-8"));
  }
  return Bun.file(output).json();
};
// 実行をまたいで使うもの（SWC の変換結果など）。プロセスどうしでも共有する
const cacheDir = resolve(
  process.env.PROOFYARD_CACHE_DIR ?? join(tmp, "proofyard-cache")
);
// 実行をまたいだキャッシュ（src/next/layer-cache.ts）。PROOFYARD_NO_CACHE=1 で使わない
const cache = process.env.PROOFYARD_NO_CACHE
  ? undefined
  : unitCache(join(cacheDir, "units"), work);
// 鍵: 結果を変えうるもののうち、ファイルの中身以外（設定、環境変数、バージョン、ファイルの一覧（増えたファイルで解決が変わる））
// 入力: どの単位も読みうるファイル（proofyard 自身、プロジェクト直下の設定や lockfile、Next.js のバージョン）と、単位ごとに読んだファイル
// アプリのソースファイル（node_modules と隠しディレクトリ（.next など）を除く）
const appSources = function* appSources(
  dir: string,
  pattern = /\.[cm]?[jt]sx?$/u
): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* appSources(path, pattern);
    } else if (pattern.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      yield path;
    }
  }
};
const NOT_SOURCE =
  /^(?:test-results|coverage|playwright-report|out|dist|build)\//u;
const TEST_FILE = /[._](?:test|spec)\.[cm]?[jt]sx?$/u;
const projectFiles = [...appSources(projectDir, /./u)].filter(
  (file) => !NOT_SOURCE.test(relative(projectDir, file))
);
const appFiles = projectFiles.filter((file) => !TEST_FILE.test(file));
const baseKey = [
  Bun.version,
  Bun.revision,
  projectDir,
  JSON.stringify(config, (_, v) =>
    typeof v === "function" ? v.toString() : v
  ),
  Object.entries(process.env)
    .filter(([k]) =>
      /^(?:NEXT_|__NEXT|NODE_ENV$|PROOFYARD_(?!DEBUG$|BUILD_OUTPUT$|RUN_DIR$))/u.test(
        k
      )
    )
    .toSorted(),
  appFiles,
];
const cacheKey = (...parts: unknown[]) =>
  Bun.hash(cache!.portable(JSON.stringify([baseKey, ...parts]))).toString(36);
// PROOFYARD_DEBUG: キャッシュを使えなかった理由と、保存しなかった理由
const cacheMiss = (name: string) =>
  debug
    ? (reason: string) =>
        console.log(`[proofyard] (${name}: not from the cache, ${reason})`)
    : undefined;
const cacheSkipped = (name: string, changed: string | undefined) => {
  if (debug && changed) {
    console.log(
      `[proofyard] (${name}: not cached, changed during the build: ${changed})`
    );
  }
};
const commonInputs = [
  ...appSources(join(import.meta.dir, ".."), /./u),
  ...readdirSync(projectDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(projectDir, e.name)),
  require.resolve("next/package.json"),
];
let buildOutput: Promise<BuildOutput> | undefined;
if (!BUILD_OUTPUT) {
  buildOutput = leader
    ? (async () => {
        const output = join(runDir, "build-output.json");
        // 前の実行の結果（アプリのファイルが同じなら。prerender が読む外部のデータ（generateStaticParams の DB など）の変化は見ない）
        const key = cache && cacheKey("build-output");
        const cached =
          key && cache!.lookup<BuildOutput>(key, cacheMiss("build-output"));
        if (cached) {
          if (debug) {
            console.log("[proofyard] (build-output: from the cache)");
          }
          write(output, cached);
          return cached;
        }
        const unit = key ? cache!.begin(key) : undefined;
        const startedAt = Date.now();
        // テストのファイルの代わりにこのファイルを渡す（プリロードの最後で終わるので読み込まれない）
        const spawned = performance.now();
        const proc = Bun.spawn(
          [
            process.execPath,
            "test",
            "--preload",
            import.meta.path,
            import.meta.path,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              PROOFYARD_BUILD_OUTPUT: output,
              PROOFYARD_RUN_DIR: runDir,
            },
            stderr: "pipe",
            stdout: "pipe",
          }
        );
        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (code !== 0) {
          const message = `[proofyard] prerendering (next build) failed\n${stdout}${stderr}`;
          write(join(runDir, "build-output.error"), message);
          throw new Error(message);
        }
        // 別プロセスの内訳（そのプロセスのログ）
        if (debug) {
          for (const line of stdout.split("\n")) {
            if (line.startsWith("[proofyard] ")) {
              console.log(`[proofyard] (prerender process) ${line.slice(12)}`);
            }
          }
          console.log(
            `[proofyard] (prerender process) total ${(performance.now() - spawned).toFixed(0)}ms`
          );
        }
        const exported: BuildOutput = await Bun.file(output).json();
        cacheSkipped(
          "build-output",
          unit?.commit([...commonInputs, ...appFiles], exported, startedAt)
        );
        return exported;
      })()
    : (waitForLeader("build-output") as Promise<BuildOutput>);
}
// prerenderRoute が使う Next.js の静的シェルのデバッグ機能を有効にしてビルドする（getDefineEnv が define に入れる。
// ?__nextppronly のリクエストだけが使う。next build をこの環境変数付きで実行するのと同じ）
if (config.cacheComponents) {
  process.env.__NEXT_EXPERIMENTAL_STATIC_SHELL_DEBUGGING = "1";
}
const pageExtensions: string[] = config.pageExtensions;
// app/ か src/app/（next build と同じ findPagesDir）
const { appDir, pagesDir } =
  require("next/dist/lib/find-pages-dir").findPagesDir(projectDir) as {
    appDir?: string;
    pagesDir?: string;
  };

if (pagesDir) {
  throw new Error(
    `[proofyard] Unsupported Next.js feature: the Pages Router (${pagesDir})`
  );
}
if (!appDir) {
  throw new Error(`[proofyard] no app directory in ${projectDir}`);
}
const isSrcDir = relative(projectDir, appDir).startsWith("src");

// next build と同じルートの発見とエントリ（build/index.ts の discoverRoutes / createPagesMapping / createEntrypoints）
// - app/ のページ・Route Handler と、組み込みの _not-found / _global-error: next-app-loader
// - Proxy（proxy.ts / middleware.ts）: next-middleware-loader
const customRoutes = await loadCustomRoutes(config);
// Proxy などのファイルは app/ の親（src/ を使うなら src/）にある。パスはプロジェクトからの "/src/proxy.ts" の形
const ROOT_FILE = new RegExp(
  `^(?:proxy|middleware|instrumentation)\\.(?:${pageExtensions.join("|")})$`,
  "u"
);
const rootDir = dirname(appDir);
const rootPaths = readdirSync(rootDir)
  .filter((file) => ROOT_FILE.test(file))
  .map((file) => `/${relative(projectDir, join(rootDir, file))}`);
const rootFile = (name: string) =>
  rootPaths.some((path) =>
    path.slice(path.lastIndexOf("/") + 1).startsWith(`${name}.`)
  );
if (rootFile("proxy") && rootFile("middleware")) {
  throw new Error(
    '[proofyard] Both "middleware" and "proxy" files are detected. Please use "proxy" only (same as next build)'
  );
}
const discovery = await discoverRoutes({
  appDir,
  appDirOnly: true,
  baseDir: projectDir,
  isDev: false,
  isSrcDir,
  pageExtensions,
});
// next build と同じく、ページの一覧（URL の形）と Intercepting Routes の rewrite（beforeFiles）
const appPaths = [
  ...new Set(
    Object.keys(discovery.mappedAppPages).map((page) => normalizeAppPath(page))
  ),
];
customRoutes.rewrites.beforeFiles.push(
  ...generateInterceptionRoutesRewrites(appPaths, config.basePath)
);
const entrypoints = await createEntrypoints({
  appDefaultPaths: discovery.mappedAppDefaults,
  appDir,
  appPaths: discovery.mappedAppPages,
  buildId: "proofyard",
  config,
  envFiles: [],
  hasInstrumentationHook: rootFile("instrumentation"),
  isDev: false,
  pageExtensions,
  pages: discovery.mappedPages ?? {},
  previewMode: {},
  rootDir: projectDir,
  rootPaths: await createPagesMapping({
    appDir,
    appDirOnly: true,
    isDev: false,
    pageExtensions,
    pagePaths: rootPaths,
    pagesType: "root",
  }),
});
if (Object.keys(entrypoints.edgeServer).length > 0) {
  throw new Error(
    `[proofyard] Unsupported Next.js feature: the edge runtime (${Object.keys(entrypoints.edgeServer).join(", ")})`
  );
}
const { middlewareMatchers } = entrypoints;
// webpack と同じく、ローダーのオプションはクエリ文字列（getOptions は querystring.parse）
// webpack のローダー（this は webpack の loader context）
type WebpackLoader = (...args: any[]) => any;
const LOADERS: Record<string, WebpackLoader> = {
  "next-app-loader": nextAppLoader,
  "next-middleware-loader": nextMiddlewareLoader,
};
// pathname → エントリ
const routes = new Map<string, { page: string; entry: string }>();
let middlewareEntry: string | undefined;
let instrumentationEntry: string | undefined;
// ローダーはルートごとに独立しているので並行に動かす（ファイルの存在確認などの待ちが多い）。登録は元の順
// metadata のファイル（sitemap.ts、robots.ts、icon.svg など）は、next-app-loader の出力が次のローダーを通して import する
//   next-metadata-route-loader: そのファイルの Route Handler（/sitemap.xml など）
//   next-metadata-image-loader: ページの <link rel="icon"> などの情報（webpack では raw のローダーなので、内容は Buffer）
// export 名は webpack の loadModule で調べるので、Next.js が Rspack で使う SWC の getModuleNamedExports で同じ形を渡す
const METADATA_LOADERS: Record<string, WebpackLoader> = {
  "next-metadata-image-loader": nextMetadataImageLoader,
  "next-metadata-route-loader": nextMetadataRouteLoader,
};
class HarmonyExportSpecifierDependency {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
// webpack の loadModule と同じ形（結果はコールバックで返す）
/* oxlint-disable promise/prefer-await-to-callbacks, promise/no-callback-in-promise -- webpack の loadModule の形 */
const loadModule = (
  path: string,
  callback: (error: unknown, ...results: unknown[]) => void
) =>
  getModuleNamedExports(path).then(
    (names: string[]) =>
      callback(null, "", null, {
        dependencies: names.map(
          (name) => new HarmonyExportSpecifierDependency(name)
        ),
      }),
    (error: unknown) => callback(error)
  );
/* oxlint-enable promise/prefer-await-to-callbacks, promise/no-callback-in-promise */
const loadMetadataFiles = async (code: string, prefix: string) => {
  let rewritten = code;
  let i = 0;
  for (const [specifier, , loader, query, resourcePath] of code.matchAll(
    /(?<quote>["'])(?<loader>next-metadata-(?:route|image)-loader)\?(?<query>[^!"']*)!(?<resourcePath>[^"'?]*)\?__next_metadata(?:_route)?__\k<quote>/gu
  )) {
    const file = join(generatedDir, `${prefix}-metadata-${i}.js`);
    i += 1;
    const options = querystring.parse(query!);
    const context = {
      addDependency() {
        // 依存の記録は使わない
      },
      getOptions: () => options,
      loadModule,
      resourcePath,
      rootContext: projectDir,
    };
    // oxlint-disable-next-line no-await-in-loop -- 番号の順に、生成したコードを順に書き換える
    const output: string = await METADATA_LOADERS[loader!]!.call(
      context,
      resourcePath ? readFileSync(resourcePath) : undefined
    );
    // 画像の情報だけを読むための別のリクエスト（webpack でモジュールを分けるためのクエリ）。ここでは同じファイルを読む
    write(file, output.replaceAll("?__next_metadata_image_meta__", ""));
    rewritten = rewritten.replace(specifier, JSON.stringify(file));
  }
  const unknown = rewritten.match(/["'](?<loader>[\w-]+-loader)\?[^"']*!/u);
  if (unknown) {
    throw new Error(
      `[proofyard] Unsupported Next.js loader in the generated code: ${unknown[1]}`
    );
  }
  return rewritten;
};
// webpack の compilation（next-app-loader はこれごとにディレクトリの中身をキャッシュする。ないと確認のたびに readdir する）
const compilation = {};
// 生成するファイルの名前は、ルートの名前の順の番号（entrypoints の順は実行ごとに変わる。実行をまたいだキャッシュは生成したファイルの中身で比べる）
const entryNames = Object.keys(entrypoints.server).toSorted();
const loaded = await Promise.all(
  Object.entries(
    entrypoints.server as Record<
      string,
      string | { import: string; layer?: string }
    >
  ).map(async ([name, value]) => {
    const i = entryNames.indexOf(name);
    const entry = join(generatedDir, `${i}.js`);
    // instrumentation はローダーを通さず、ファイルそのもの（getInstrumentationEntry。Proxy と同じ react-server の層）
    if (typeof value === "object" && value.layer === "instrument") {
      write(
        entry,
        `export * from ${JSON.stringify(value.import.replace(/^private-next-root-dir\//u, `${projectDir}/`))};\n`
      );
      return { entry, kind: "instrumentation" } as const;
    }
    const request = typeof value === "string" ? value : value.import;
    const [, loader, query] =
      request.match(/^(?<loader>[^?!]+)\?(?<query>.*)!$/u) ?? [];
    if (!loader || !LOADERS[loader]) {
      throw new Error(
        `[proofyard] Unsupported Next.js entry: ${name} (${request})`
      );
    }
    const options = querystring.parse(query!);
    const code: string = await loadMetadataFiles(
      await LOADERS[loader]!.call({
        _compilation: compilation,
        _module: { buildInfo: {} },
        addContextDependency() {
          // 依存の記録は使わない
        },
        addDependency() {
          // 依存の記録は使わない
        },
        addMissingDependency() {
          // 依存の記録は使わない
        },
        context: projectDir,
        getOptions: () => options,
        rootContext: projectDir,
        utils: {
          contextify: (context: string, specifier: string) =>
            specifier.startsWith("/")
              ? `./${relative(context, specifier)}`
              : specifier,
        },
      }),
      String(i)
    );
    write(
      entry,
      code
        // Turbopack 用の import 属性
        .replaceAll(/\s+with\s*\{\s*'turbopack-transition'[^}]*\}/gu, "")
        // export * from entry-base（CJS）の名前は Bun.build の ESM の出力では消える。名前空間でも出し、server/app/*.js で戻す
        .replace(
          /^export \* from (?<specifier>['"][^'"]*\/entry-base['"]);?$/mu,
          "$&\nexport * as __proofyardEntryBase from $1;"
        )
        // Client Component の読み込み（webpack の __webpack_require__ の代わり）
        .replace(
          "const __next_app_require__ = __webpack_require__",
          "const __next_app_require__ = (id) => globalThis.__proofyardNextRequire(id)"
        )
        // webpack の resolve.alias（private-next-root-dir → プロジェクト）
        .replaceAll(
          /(?<quote>["'])private-next-root-dir\//gu,
          `$1${projectDir}/`
        )
    );
    if (loader === "next-middleware-loader") {
      return { entry, kind: "middleware" } as const;
    }
    return { entry, kind: "page", page: options.page as string } as const;
  })
);
for (const result of loaded) {
  if (result.kind === "instrumentation") {
    instrumentationEntry = result.entry;
  } else if (result.kind === "middleware") {
    middlewareEntry = result.entry;
  } else {
    routes.set(normalizeAppPath(result.page), {
      entry: result.entry,
      page: result.page,
    });
  }
}
console.log(
  `[proofyard] entries: ${routes.size} routes${middlewareEntry ? " + proxy" : ""}${instrumentationEntry ? " + instrumentation" : ""} ${(performance.now() - t).toFixed(0)}ms`
);

t = performance.now();
// 内訳（設定・SWC・フォント・バレルの準備、rsc 層のビルド、node_modules をたどる、SSR 層のビルド、その他）
const laps: string[] = [];
let lapStart = t;
const lap = (label: string) => {
  const now = performance.now();
  laps.push(`${label} ${(now - lapStart).toFixed(0)}ms`);
  lapStart = now;
};
// next build と同じ define（nodejs のサーバー。bun test の NODE_ENV=test は production 扱い）
const hasRewrites = Object.values(
  customRoutes.rewrites as Record<string, unknown[]>
).some((r) => r.length > 0);
const nextDefine: Record<string, unknown> = getDefineEnv({
  config,
  dev: process.env.NODE_ENV === "development",
  distDir,
  fetchCacheKeyPrefix: config.experimental.fetchCacheKeyPrefix,
  hasRewrites,
  isClient: false,
  isEdgeServer: false,
  isNodeServer: true,
  isTurbopack: false,
  middlewareMatchers,
  projectPath: projectDir,
  rewrites: customRoutes.rewrites,
});
// webpack の DefinePlugin と同じく undefined は undefined に（Bun.build は文字列だけ受け付ける）
const define = Object.fromEntries(
  Object.entries(nextDefine).map(([k, v]) => [
    k,
    typeof v === "string" ? v : String(v),
  ])
);
// rsc 層のアプリのソースは next-swc-loader と同じ SWC 変換（"use cache" / "use server" はここで変換される）
// next build と同じく、鍵は環境変数（NEXT_SERVER_ACTIONS_ENCRYPTION_KEY）か、保存したもの（next build は distDir/cache/.rscinfo）を使い回す。
// Server Action の id もこの鍵で決まるので、SWC の変換結果を使い回せる
const encryptionKey = (() => {
  if (process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) {
    return process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
  }
  const file = join(cacheDir, "encryption-key");
  mkdirSync(cacheDir, { recursive: true });
  try {
    writeFileSync(file, randomBytes(32).toString("base64"), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  return readFileSync(file, "utf-8");
})();
const dev = process.env.NODE_ENV === "development";
// tsconfig / jsconfig（Next.js と同じ loadJsConfig。paths の解決は webpack では JsConfigPathsPlugin、ここでは Bun の tsconfig の対応）
const loadedJsConfig = await require("next/dist/build/load-jsconfig").default(
  projectDir,
  config
);

const jsConfig = loadedJsConfig.jsConfig ?? { compilerOptions: {} };
// next-swc-loader と同じ SWC の設定（層ごと。webpack-config.ts の swcLoader の設定）
// browser は act のために開発版の React にしている（loadBrowser）ので development。route（renderRoute）は next build と同じ
const SWC_LAYERS = {
  browser: {
    bundleLayer: "app-pages-browser",
    development: true,
    isServer: false,
  },
  route: {
    bundleLayer: "app-pages-browser",
    development: dev,
    isServer: false,
  },
  rsc: { bundleLayer: "rsc", development: dev, isServer: true },
  ssr: { bundleLayer: "ssr", development: dev, isServer: true },
} as const;
const swcOptions = (filename: string, layer: keyof typeof SWC_LAYERS = "rsc") =>
  getLoaderSWCOptions({
    filename,
    ...SWC_LAYERS[layer],
    appDir,
    cacheHandlers: config.cacheHandlers,
    compilerOptions: config.compiler,
    configDir: projectDir,
    esm: true,
    hasReactRefresh: false,
    isCacheComponents: config.cacheComponents,
    isPageFile: false,
    jsConfig,
    modularizeImports: config.modularizeImports,
    optimizePackageImports: config.experimental.optimizePackageImports,
    optimizeServerReact: config.experimental.optimizeServerReact,
    pageExtensions,
    relativeFilePathFromRoot: relative(projectDir, filename),
    serverComponents: true,
    serverReferenceHashSalt: encryptionKey,
    supportedBrowsers: undefined,
    // SWC のプラグインのキャッシュ（jsc.experimental.cacheRoot）。変換結果のキーに入るので、プロセスごとに変えない
    swcCacheDir: join(cacheDir, "swc-plugins"),
    swcPlugins: config.experimental.swcPlugins,
    taintEnabled: config.experimental.taint,
    trackDynamicImports: !!config.cacheComponents && SWC_LAYERS[layer].isServer,
    useCacheEnabled: config.experimental.useCache,
  });
// 変換結果は、Next.js の版・SWC の設定・ファイル名・中身が同じなら同じなので、保存して使い回す（プロセスどうし・実行どうし）。
// SWC のプラグインは中身がキーに入らないので、使うアプリでは保存しない
// ponytail: 古い結果は消さない。増えすぎたら PROOFYARD_CACHE_DIR ごと消す
const NEXT_VERSION: string = require("next/package.json").version;

const swcCacheDir = join(cacheDir, "swc");
mkdirSync(swcCacheDir, { recursive: true });
const swcCompile = (
  filename: string,
  source: string,
  layer: keyof typeof SWC_LAYERS = "rsc"
): string => {
  const options = {
    ...swcOptions(filename, layer),
    filename,
    sourceFileName: filename,
  };
  if (config.experimental.swcPlugins?.length) {
    return transformSync(source, options).code;
  }
  const key = new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify([NEXT_VERSION, options], (_, v) =>
        v instanceof RegExp || typeof v === "function" ? String(v) : v
      )
    )
    .update(source)
    .digest("hex");
  const file = join(swcCacheDir, `${key}.js`);
  if (existsSync(file)) {
    return readFileSync(file, "utf-8");
  }
  const { code } = transformSync(source, options);
  // 別のプロセスが同時に書いても壊れないよう、書き終えてから名前を付ける
  const temp = `${file}.${process.pid}`;
  writeFileSync(temp, code);
  renameSync(temp, file);
  return code;
};

// CSS と next/font（src/next/css.ts）
const { style, font } = createStyleLoader(projectDir, config);
// next/font: SWC が書き換えた import（target.css?{...}）を、起動時に生成したモジュールに置き換える
// （rsc 層のネイティブ読み込みの変換は同期で、フォントの読み込みは非同期なので、アプリのソースから先に集めて作っておく）
// import の指定子 → 生成したファイル
const fonts = new Map<string, string>();
// import の指定子 → next-font-loader が出力したフォントのファイル（static/media/...）
const fontFiles = new Map<string, string[]>();
// アプリのソース → その中の next/font の import の指定子
const sourceFonts = new Map<string, string[]>();
await Promise.all(
  [...appSources(projectDir)].flatMap((file) => {
    const source = readFileSync(file, "utf-8");
    if (!source.includes("next/font/")) {
      return [];
    }
    const imports = [...swcCompile(file, source).matchAll(FONT_IMPORT)];
    sourceFonts.set(
      file,
      imports.map(([specifier]) => specifier)
    );
    return imports.map(async ([specifier, target, query]) => {
      if (fonts.has(specifier)) {
        return;
      }
      const out = join(work, "fonts", `${fonts.size}.js`);
      fonts.set(specifier, out);
      const { code, files } = await font(target!, unquote(query!));
      write(out, code);
      // next start は .next/static を /_next/static で配信する
      for (const [name, content] of files) {
        mkdirSync(dirname(join(distDir, name)), { recursive: true });
        writeFileSync(join(distDir, name), content);
      }
      fontFiles.set(specifier, [...files.keys()]);
    });
  })
);
// next-font-manifest.json（next build の NextFontManifestPlugin）。Next.js はレイアウト・ページなどのファイル（拡張子なし）ごとに、
// ここにあるフォントを preload する。next build ではそのファイルのクライアントのエントリ（チャンクグループ）にある next/font のモジュールのフォントで、
// ここではそのファイルから静的な import（Client Component の先も）でたどれるアプリのソースの next/font。動的な import() は webpack では別のチャンクになるので、たどらない
const nextFontManifest = {
  app: {} as Record<string, string[]>,
  appUsingSizeAdjust: false,
  pages: {},
  pagesUsingSizeAdjust: false,
};
if (fontFiles.size) {
  const transpiler = new Bun.Transpiler({ loader: "tsx" });
  const importsOf = new Map<string, string[]>();
  const staticImports = (file: string) => {
    let imports = importsOf.get(file);
    if (!imports) {
      importsOf.set(file, (imports = []));
      for (const { path, kind } of transpiler.scanImports(
        readFileSync(file, "utf-8")
      )) {
        if (kind === "dynamic-import") {
          continue;
        }
        try {
          const resolved = Bun.resolveSync(path, dirname(file));
          if (
            resolved.startsWith(`${projectDir}/`) &&
            !resolved.includes("/node_modules/") &&
            /\.[cm]?[jt]sx?$/u.test(resolved)
          ) {
            imports.push(resolved);
          }
        } catch {
          // 解決できない import は Next.js のビルドがエラーにする（ここではフォントを探すだけ）
        }
      }
    }
    return imports;
  };
  const SEGMENT_FILE =
    /^(?:layout|page|template|loading|error|global-error|not-found|global-not-found|forbidden|unauthorized|default)\.[cm]?[jt]sx?$/u;
  for (const file of appSources(appDir)) {
    if (!SEGMENT_FILE.test(basename(file))) {
      continue;
    }
    const seen = new Set<string>();
    const stack = [file];
    const files: string[] = [];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const specifier of sourceFonts.get(current) ?? []) {
        files.push(...fontFiles.get(specifier)!);
      }
      stack.push(...staticImports(current));
    }
    if (!files.length) {
      continue;
    }
    // size-adjust の代わりのフォント（-s）と preload するもの（.p.）は、next-font-loader がファイル名で表す
    if (files.some((name) => name.includes("-s"))) {
      nextFontManifest.appUsingSizeAdjust = true;
    }
    nextFontManifest.app[file.replace(/\.[^.]+$/u, "")] = files.filter((name) =>
      /\.p\.(?:woff|woff2|eot|ttf|otf)$/u.test(name)
    );
  }
}
const withFonts = (code: string) =>
  code.replace(FONT_IMPORT, (specifier) => {
    const file = fonts.get(specifier);
    if (!file) {
      throw new Error(
        `[proofyard] next/font was not prepared for ${specifier}`
      );
    }
    return JSON.stringify(file);
  });
// webpack のローダー（Next.js のもの）を、使う分だけの webpack のローダーの context で呼ぶ
const { trace } = require("next/dist/trace");

const runLoader = (
  loader: WebpackLoader,
  resourcePath: string,
  options: object,
  source: string
) => {
  const result = Promise.withResolvers<string>();
  const callback = (error: Error | null, code: string) =>
    error ? result.reject(error) : result.resolve(code);
  // new Promise と同じく、ローダーが同期で投げたものも拒否にする
  try {
    loader.call(
      {
        addDependency() {
          // 依存の記録は使わない
        },
        async: () => callback,
        cacheable() {
          // キャッシュの可否は使わない
        },
        callback,
        clearDependencies() {
          // 依存の記録は使わない
        },
        currentTraceSpan: trace("proofyard"),
        emitWarning: (warning: Error) => console.warn(warning),
        fs: { readFile },
        getOptions: () => options,
        // oxlint-disable-next-line require-await -- webpack の getResolve は Promise を返す（解決は同期）
        getResolve: () => async (from: string, request: string) =>
          Bun.resolveSync(request, from),
        resourcePath,
        sourceMap: false,
        target: "web",
      },
      source
    );
  } catch (error) {
    result.reject(error);
  }
  return result.promise;
};
// optimizePackageImports（@mui/material・lucide-react など。Next.js の既定の一覧もある）: SWC は import { A } from "pkg" を
// "__barrel_optimize__?names=A!=!pkg" に書き換え、webpack では next-barrel-loader が A を export するファイルだけを読むモジュールにする。
// 同じローダーで作ったモジュールをファイルに書き、指定子をそのパスに置き換える
// （ローダーは非同期で、ネイティブ読み込みの変換は同期なので、アプリのソースから先に作っておく）
const BARREL_IMPORT =
  /"__barrel_optimize__\?names=(?<names>[^"&!]*)[^"!]*!=!(?<request>[^"]+)"/gu;
const barrelDir = join(work, "barrels");
// 解決元のディレクトリ + 指定子 → 生成したファイル
const barrels = new Map<string, string>();
const {
  default: nextBarrelLoader,
} = require("next/dist/build/webpack/loaders/next-barrel-loader");

const withBarrels = (code: string, dir: string) =>
  code.replaceAll(BARREL_IMPORT, (spec) => {
    const file = barrels.get(`${dir}\0${spec}`);
    if (!file) {
      throw new Error(
        `[proofyard] Unsupported: optimizePackageImports for ${spec} imported from ${dir} (only the app's source files are prepared)`
      );
    }
    return JSON.stringify(file);
  });
const prepareBarrels = async (code: string, dir: string): Promise<void> => {
  for (const [spec, names, request] of code.matchAll(BARREL_IMPORT)) {
    const key = `${dir}\0${spec}`;
    if (barrels.has(key)) {
      continue;
    }
    const file = join(barrelDir, `${barrels.size}.mjs`);
    barrels.set(key, file);
    const resourcePath = Bun.resolveSync(request!, dir);
    // oxlint-disable-next-line no-await-in-loop -- 生成するファイルの番号（barrels.size）を毎回同じ順にする
    const output = await runLoader(
      nextBarrelLoader,
      resourcePath,
      { names: names!.split(","), swcCacheDir: join(cacheDir, "swc-plugins") },
      ""
    );
    // 中の指定子（バレルのファイルからの相対パス、export * の先の __barrel_optimize__）も、生成したファイルから読めるようにする
    // oxlint-disable-next-line no-await-in-loop -- 同上（番号の順）
    await prepareBarrels(output, dirname(resourcePath));
    write(
      file,
      withBarrels(output, dirname(resourcePath)).replaceAll(
        / from "(?<specifier>(?!\/)[^"]+)"/gu,
        (_, specifier) =>
          ` from ${JSON.stringify(Bun.resolveSync(specifier, dirname(resourcePath)))}`
      )
    );
  }
};
const barrelPackages: string[] =
  config.experimental.optimizePackageImports ?? [];
// rsc 層からだけでは足りない（"use client" のファイルは Client Reference になり import が消える）ので、SSR 層・ブラウザ層の出力からも集める。
// その層で使えない API の import で失敗するファイル（Client Component からだけ読まれる、"use client" のないファイルなど）は、その層では読まれないので飛ばす
const tryCompile = (
  file: string,
  source: string,
  layer: keyof typeof SWC_LAYERS
) => {
  try {
    return swcCompile(file, source, layer);
  } catch {
    return "";
  }
};
for (const file of appSources(projectDir)) {
  const source = readFileSync(file, "utf-8");
  if (barrelPackages.some((name) => source.includes(name))) {
    for (const layer of ["rsc", "ssr", "browser"] as const) {
      // oxlint-disable-next-line no-await-in-loop -- 生成するファイルの番号を毎回同じ順にする
      await prepareBarrels(tryCompile(file, source, layer), dirname(file));
    }
  }
}
lap("prepare");
const withImports = (filename: string, code: string) =>
  withBarrels(withFonts(code), dirname(filename));
// ネイティブ読み込み時の SWC 変換（同期。非同期の onLoad を経たモジュールは require できない。route.ts は require で読まれる）
const swcTransformSync = (filename: string, source: string): string =>
  withImports(filename, swcCompile(filename, source));
// SSR 層・ブラウザ層のアプリのソース（Client Component）の変換（typeof window の置き換えなども Next.js と同じになる）
const isAppSource = (path: string) =>
  path.startsWith(`${projectDir}/`) && !path.includes("/node_modules/");
// React Compiler（reactCompiler）: Next.js はクライアントのコンパイル（ブラウザ層）のアプリのソースだけを、SWC の前に Babel で変換する
// （サーバーの rsc 層・SSR 層には使わない。getReactCompilerLoader は isServer なら undefined）
const reactCompilerLoader =
  require("next/dist/build/get-babel-loader-config").getReactCompilerLoader(
    config.reactCompiler,
    projectDir,
    false,
    undefined,
    dev
  );

// oxlint-disable-next-line require-await -- 変換しないときも Promise を返す
const reactCompile = async (filename: string, source: string) =>
  reactCompilerLoader && isAppSource(filename)
    ? runLoader(
        require(reactCompilerLoader.loader).default,
        filename,
        reactCompilerLoader.options,
        source
      )
    : source;
// node_modules は "use server" / "use cache" のあるものだけ（Client Component から import した Server Action を Server Reference にする）
const swcTransformFor =
  (layer: "ssr" | "browser" | "route") =>
  async (filename: string, source: string) =>
    isAppSource(filename) || SERVER_DIRECTIVE.test(source)
      ? withImports(
          filename,
          swcCompile(
            filename,
            layer === "ssr" ? source : await reactCompile(filename, source),
            layer
          )
        )
      : undefined;
const entries = [...routes.values()].map((r) => r.entry);
if (middlewareEntry !== undefined) {
  entries.push(middlewareEntry);
}
if (instrumentationEntry !== undefined) {
  entries.push(instrumentationEntry);
}

// rsc 層: Next.js 本体だけをバンドルし、アプリはネイティブで読み込む（mock.module が効く）。
// アプリが import しうる Next.js 本体のモジュール（next/cache などの公開の入口、SWC が出力する private-next-rsc-* など）も
// 同じバンドルの入口にする。ネイティブで読むと define が効かず（NODE_ENV など）、本番と違うコードが動くため
// 指定子 → ファイル
const nextFacades = new Map<string, string>();
for (const [spec, target] of Object.entries(BUNDLED_ALIASES.rsc)) {
  nextFacades.set(spec, Bun.resolveSync(target, process.cwd()));
}
// App Router の公開の入口（Pages Router 専用のもの（next/document など）は rsc 層では使わない）
// ponytail: 一覧にない next/* をネイティブで読むと define が効かない。必要になったら一覧に足す
// （next/og は画像生成で重いので除いている）
const APP_ROUTER_ENTRIES = [
  "cache",
  "headers",
  "server",
  "image",
  "script",
  "root-params",
  "constants",
];
for (const name of APP_ROUTER_ENTRIES) {
  const spec = `next/${name}`;
  if (nextFacades.has(spec)) {
    continue;
  }
  try {
    nextFacades.set(spec, Bun.resolveSync(spec, process.cwd()));
  } catch {
    // このバージョンの Next.js にない入口
  }
}
// 入口は名前空間を default で渡す小さな ESM（入口を直接使うと、CJS → ESM 変換や export * の再エクスポートで export を取りこぼす）
// プリロード自身が使う Next.js 本体のモジュール（バンドルの中のものを使う。ネイティブで読むと別の複製になる）
const MANIFESTS_SINGLETON = Bun.resolveSync(
  "next/dist/server/app-render/manifests-singleton",
  process.cwd()
);
// ファイル → 入口
const facadeEntries = new Map<string, string>();
for (const file of new Set([...nextFacades.values(), MANIFESTS_SINGLETON])) {
  const entry = join(generatedDir, `facade-${facadeEntries.size}.mjs`);
  write(
    entry,
    `import * as m from ${JSON.stringify(file)};\nexport default m;\n`
  );
  facadeEntries.set(file, entry);
}
// 最初のプロセスが 1 回だけ求めて runDir に書き、他のプロセス（--parallel の他のワーカーと prerender の別プロセス）はそれを読む。
// 求めるときは、前の実行の結果が使えればそれを使う。compute は出力のディレクトリと、読んだファイルを足す Set を受け取る。
// 使い回したときは compute を呼ばないので、結果の副作用（Client Reference など）は呼び出し側が反映する
const share = async <T>(
  name: string,
  keyParts: unknown,
  compute: (outdir: string, inputs: Set<string>) => Promise<T>
): Promise<T> => {
  if (!leader) {
    return waitForLeader(name);
  }
  const file = join(runDir, `${name}.json`);
  try {
    const key =
      cache &&
      cacheKey(define, Bun.hash(encryptionKey).toString(36), name, keyParts);
    let value = key ? cache!.lookup<T>(key, cacheMiss(name)) : undefined;
    if (value === undefined) {
      const unit = key ? cache!.begin(key) : undefined;
      const startedAt = Date.now();
      const inputs = new Set(commonInputs);
      value = await compute(
        unit ? join(unit.dir, "out") : join(runDir, name),
        inputs
      );
      cacheSkipped(name, unit?.commit(inputs, value, startedAt));
    } else if (debug) {
      console.log(`[proofyard] (${name}: from the cache)`);
    }
    write(`${file}.${process.pid}`, value);
    renameSync(`${file}.${process.pid}`, file);
    return value;
  } catch (error) {
    write(join(runDir, `${name}.error`), Bun.inspect(error));
    throw error;
  }
};
interface SharedClientReferences {
  clientIds: string[];
  esmClientIds: string[];
  clientExports: [string, string[]][];
}
const addClientReferences = (shared: SharedClientReferences) => {
  for (const id of shared.clientIds) {
    clientIds.add(id);
  }
  for (const id of shared.esmClientIds) {
    esmClientIds.add(id);
  }
  for (const [id, names] of shared.clientExports) {
    clientExports.set(id, names);
  }
};
// 層のビルド。ビルドの副作用（rsc 層のバンドルで見つけた Client Reference）も一緒に渡す。
// 入口は同じコードと同じアプリから同じ順で作るので、出力は順番で対応させる（生成した入口のパスはプロセスごとに違う）
// styled: CSS を読む層。CSS（Tailwind など）はアプリのどのファイルからも作られうるので、アプリのファイルをすべて入力にする
const shareLayer = async (
  name: string,
  layerEntries: string[],
  build: (outdir: string, inputs: Set<string>) => Promise<Map<string, string>>,
  styled = false
): Promise<Map<string, string>> => {
  let out: Map<string, string> | undefined;
  const shared = await share(name, layerEntries, async (outdir, inputs) => {
    if (styled) {
      for (const file of appFiles) {
        inputs.add(file);
      }
    }
    out = await build(outdir, inputs);
    return {
      clientExports: [...clientExports],
      clientIds: [...clientIds],
      esmClientIds: [...esmClientIds],
      outputs: [...out.values()],
    };
  });
  if (out) {
    return out;
  }
  if (shared.outputs.length !== layerEntries.length) {
    throw new Error(
      `[proofyard] the shared ${name} layer has ${shared.outputs.length} outputs for ${layerEntries.length} entries`
    );
  }
  addClientReferences(shared);
  return new Map(layerEntries.map((entry, i) => [entry, shared.outputs[i]!]));
};
// 名前の順（ルートの登録の順は実行ごとに変わる。実行をまたいだキャッシュの鍵になる）
const rscEntries = [...entries, ...facadeEntries.values()].toSorted();
const rsc = await shareLayer("rsc", rscEntries, (outdir, inputs) =>
  buildLayer("rsc", rscEntries, {
    define,
    generatedDir,
    inputs,
    nativeDir: projectDir,
    outdir,
    style,
  })
);
lap("rsc build");

// アプリの "use client" ファイルを Client Reference として登録する（Next.js 本体のものは rsc 層のビルドで登録済み）
const sourceLoader = (path: string) =>
  (path.match(/\.(?<ext>[jt]sx?)$/u)?.[1] ?? "js") as
    | "js"
    | "jsx"
    | "ts"
    | "tsx";
// Server Action の id → ファイル（next build は SWC の変換結果から集めて server-reference-manifest.json に書く）
const actionFiles = new Map<string, string>();
// node_modules のファイル → 代わりのモジュール
const nativeReplacements = new Map<string, string>();
// 読み込んだときに失敗するモジュール（import の名前の解決で先に失敗しないよう、元のモジュールの export 名を持たせる）
const failModule = (message: string, exports: string[] = []) =>
  `throw new Error(${JSON.stringify(message)});\nexport default undefined;\n${exports
    .filter((n) => n !== "default")
    .map((n) => `export const ${n} = undefined;\n`)
    .join("")}`;
// アプリと node_modules を辿った結果は、最初のプロセスが求めて他のプロセス（--parallel の他のワーカーと prerender の別プロセス）と共有する
let traversedHere = false;
// oxlint-disable-next-line complexity -- アプリと node_modules を辿る一連の処理
const traversed = await share("native", projectFiles, async (_, inputs) => {
  traversedHere = true;
  // node_modules の import を辿るファイル
  const nodeModuleImports: [string, string][] = [];
  for (const path of appSources(projectDir)) {
    inputs.add(path);
    const source = readFileSync(path, "utf-8");
    if (/["']use server["']/u.test(source)) {
      for (const m of swcTransformSync(path, source).matchAll(
        /registerServerReference\([^,]+,\s*"(?<id>[0-9a-f]+)"/gu
      )) {
        actionFiles.set(m[1]!, path);
      }
    }
    if (USE_CLIENT.test(source)) {
      clientReferenceStub(path, source);
      continue;
    }
    // optimizePackageImports の import は、書き換えた後の（必要なファイルだけを読む）モジュールから辿る
    // （rsc 層で変換できないファイルは rsc 層では読まれないので辿らない）
    if (!barrelPackages.some((name) => source.includes(name))) {
      nodeModuleImports.push([path, source]);
    } else if (tryCompile(path, source, "rsc")) {
      nodeModuleImports.push([path, swcTransformSync(path, source)]);
    }
  }
  // node_modules の "use client" はネイティブで読むとサーバーで実行されてしまう。アプリの import から node_modules を辿って
  // 見つけたものを Client Reference の代わりのモジュールにする（Next.js は rsc 層で node_modules もバンドルして同じことをする）
  // ponytail: 静的な import / require だけを辿る（require(変数) などの動的なものは辿れない）
  // exports に react-server の条件を持つパッケージは、Next.js の rsc 層（webpack の conditionNames）では別のファイルになる。
  // Bun の解決（--conditions react-server）で求め、元のファイルを読んだら react-server のファイルを読むようにする
  // ponytail: package.json に "react-server" と書かれたパッケージへの、パッケージ名での import だけを別プロセスで解決する
  // （相対パスは exports を通らないので条件で変わらない）。同じパッケージからの同じ指定子は使い回す。多ければ 1 つのプロセスにまとめる
  // ディレクトリ → それを含むパッケージ（name のある package.json）のディレクトリ
  const packageDirs = new Map<string, string | undefined>();
  const packageDir = (dir: string): string | undefined => {
    if (!packageDirs.has(dir)) {
      const pkg = join(dir, "package.json");
      inputs.add(pkg);
      let found: string | undefined;
      if (existsSync(pkg) && /"name"\s*:/u.test(readFileSync(pkg, "utf-8"))) {
        found = dir;
      } else if (dir !== dirname(dir)) {
        found = packageDir(dirname(dir));
      }
      packageDirs.set(dir, found);
    }
    return packageDirs.get(dir);
  };
  // パッケージのディレクトリ → package.json に "react-server" を含む
  const hasReactServerCondition = new Map<string, boolean>();
  // 指定子 + import 元のパッケージ → 解決したファイル
  const reactServerResolved = new Map<string, string>();
  let reactServerSpawns = 0;
  const reactServerResolve = (
    spec: string,
    from: string,
    resolved: string
  ): string => {
    if (/^[./]/u.test(spec)) {
      return resolved;
    }
    const dir = packageDir(dirname(resolved));
    if (!dir) {
      return resolved;
    }
    if (!hasReactServerCondition.has(dir)) {
      hasReactServerCondition.set(
        dir,
        readFileSync(join(dir, "package.json"), "utf-8").includes(
          '"react-server"'
        )
      );
    }
    if (!hasReactServerCondition.get(dir)) {
      return resolved;
    }
    const key = `${spec}\0${packageDir(from) ?? from}`;
    if (!reactServerResolved.has(key)) {
      reactServerSpawns += 1;
      const proc = Bun.spawnSync([
        process.execPath,
        "--conditions",
        "react-server",
        "-e",
        "console.log(Bun.resolveSync(process.argv[1], process.argv[2]))",
        spec,
        from,
      ]);
      if (!proc.success) {
        throw new Error(
          `[proofyard] failed to resolve ${spec} with the react-server condition from ${from}\n${proc.stderr}`
        );
      }
      reactServerResolved.set(key, proc.stdout.toString().trim());
    }
    return reactServerResolved.get(key)!;
  };
  const visited = new Set<string>();
  // 同じ深さのファイルをまとめて並行に読む（1 つずつ読むと、初めて開くファイルの待ち時間が積み重なる。macOS は初回に検査する）
  for (let frontier = nodeModuleImports; frontier.length;) {
    const next: string[] = [];
    for (const [path, source] of frontier) {
      for (const { path: spec } of new Bun.Transpiler({
        loader: sourceLoader(path),
      }).scanImports(source)) {
        if (
          /^(?:node:|bun:)/u.test(spec) ||
          spec in ALIASES.rsc ||
          nextFacades.has(spec) ||
          spec === "next" ||
          spec.startsWith("next/")
        ) {
          continue;
        }
        let resolved: string;
        try {
          resolved = Bun.resolveSync(spec, dirname(path));
        } catch {
          continue;
        }
        if (
          !(
            resolved.includes("/node_modules/") ||
            resolved.startsWith(`${barrelDir}/`)
          ) ||
          !/\.[cm]?js$/u.test(resolved)
        ) {
          continue;
        }
        const target = reactServerResolve(spec, dirname(path), resolved);
        if (target !== resolved && !nativeReplacements.has(resolved)) {
          inputs.add(target);
          const { exports } = new Bun.Transpiler({ loader: "js" }).scan(
            readFileSync(target, "utf-8")
          );
          nativeReplacements.set(
            resolved,
            exports.length
              ? `export * from ${JSON.stringify(target)};\n${exports.includes("default") ? `export { default } from ${JSON.stringify(target)};\n` : ""}`
              : failModule(
                  `[proofyard] Unsupported: CommonJS react-server exports in node_modules (${target})`
                )
          );
          resolved = target;
        }
        if (visited.has(resolved)) {
          continue;
        }
        visited.add(resolved);
        inputs.add(resolved);
        next.push(resolved);
      }
    }
    const sources: string[] = [];
    // ponytail: 同時に開くのは 64 まで（macOS の既定のファイル数の上限は 256）
    for (let i = 0; i < next.length; i += 64) {
      sources.push(
        // oxlint-disable-next-line no-await-in-loop -- 同時に開くファイルの数を抑える
        ...(await Promise.all(
          next.slice(i, i + 64).map((file) => Bun.file(file).text())
        ))
      );
    }
    frontier = [];
    for (const [i, resolved] of next.entries()) {
      const dep = sources[i]!;
      if (USE_CLIENT.test(dep)) {
        nativeReplacements.set(resolved, clientReferenceStub(resolved, dep));
        continue;
      }
      if (SERVER_DIRECTIVE.test(dep)) {
        // "use server" / "use cache" は、Next.js と同じくアプリのソースと同じ SWC で変換する（Next.js の SWC の設定は node_modules かどうかをパスで見る）。
        // CommonJS は実行時のプラグインで module.exports が失われるので未対応
        const { exports, imports } = new Bun.Transpiler({ loader: "js" }).scan(
          dep
        );
        if (
          !exports.length &&
          !imports.length &&
          /\b(?:module\.)?exports\b/u.test(dep)
        ) {
          nativeReplacements.set(
            resolved,
            failModule(
              `[proofyard] Unsupported: CommonJS "use server" / "use cache" modules in node_modules (${resolved})`,
              cjsExportNames(dep)
            )
          );
        } else {
          const code = swcTransformSync(resolved, dep);
          for (const m of code.matchAll(
            /registerServerReference\([^,]+,\s*"(?<id>[0-9a-f]+)"/gu
          )) {
            actionFiles.set(m[1]!, resolved);
          }
          nativeReplacements.set(resolved, code);
        }
      }
      frontier.push([resolved, dep]);
    }
  }
  return {
    actionFiles: [...actionFiles],
    barrelDir,
    clientExports: [...clientExports],
    clientIds: [...clientIds],
    esmClientIds: [...esmClientIds],
    nativeReplacements: [...nativeReplacements],
    summary: `${visited.size} files, ${reactServerSpawns} react-server resolves`,
  };
});
if (!traversedHere) {
  for (const [id, path] of traversed.actionFiles) {
    actionFiles.set(id, path);
  }
  // バレルのファイルはプロセスごとの場所にある（同じ順に作るので名前は同じ）
  for (const [path, code] of traversed.nativeReplacements) {
    nativeReplacements.set(
      path.startsWith(`${traversed.barrelDir}/`)
        ? `${barrelDir}${path.slice(traversed.barrelDir.length)}`
        : path,
      code
    );
  }
  addClientReferences(traversed);
}
// 順を揃える（rsc 層のビルドは並行に読むので、見つけた順は実行ごとに変わる。後の層の入口の順と、実行をまたいだキャッシュの鍵になる）
for (const id of [...clientIds].toSorted()) {
  clientIds.delete(id);
  clientIds.add(id);
}
lap(`node_modules (${traversed.summary})`);
// ブラウザ層（Client Mode）
// - Next.js のブラウザ向けの define（getDefineEnv の isClient）
// - Flight クライアントのモジュール読み込み（globalThis.__next_require__）を SSR と分ける
const BROWSER_RUNTIME = join(import.meta.dir, "../client/runtime.ts");
// ビルドはプリロードで済ませる。読み込み（評価）は最初の render() で DOM を入れた後（react-dom は読み込み時に window を見る）
// ブラウザ層のファイルの差し替え（create-compiler-aliases.ts の isClient のもの）
// - .browser の兄弟があるモジュールはそれに（サーバーの処理をブラウザのバンドルに入れない）
// - Instant Navigation Testing API を使わないなら navigation-testing-lock は無効版に
// - experimental.concurrentRouterQueue ならルーターの入口を concurrent の実装に
const nextDist = dirname(
  Bun.resolveSync("next/dist/server/next", process.cwd())
).replace(/\/server$/u, "");
const testingApiEnabled =
  !!config.cacheComponents &&
  (dev || !!config.experimental.exposeTestingApiInProductionBuild);
const browserRedirect = (resolved: string): string | undefined => {
  if (!resolved.startsWith(`${nextDist}/`) || !resolved.endsWith(".js")) {
    return undefined;
  }
  const rel = resolved.slice(nextDist.length + 1, -".js".length);
  if (
    !testingApiEnabled &&
    rel === "client/components/segment-cache/navigation-testing-lock"
  ) {
    return join(
      nextDist,
      "client/components/segment-cache/navigation-testing-lock.disabled.js"
    );
  }
  if (config.experimental.concurrentRouterQueue) {
    if (rel === "client/components/navigator") {
      return join(nextDist, "client/components/concurrent-router-queue.js");
    }
    if (rel === "client/app-call-server") {
      return join(nextDist, "client/concurrent-call-server.js");
    }
  }
  const sibling = join(nextDist, `${rel}.browser.js`);
  return !rel.endsWith(".browser") && existsSync(sibling) ? sibling : undefined;
};
// Next.js のブラウザ向けの define
const clientDefine = Object.fromEntries(
  Object.entries(
    getDefineEnv({
      config,
      dev,
      distDir,
      fetchCacheKeyPrefix: config.experimental.fetchCacheKeyPrefix,
      hasRewrites,
      isClient: true,
      isEdgeServer: false,
      isNodeServer: false,
      isTurbopack: false,
      middlewareMatchers,
      projectPath: projectDir,
      rewrites: customRoutes.rewrites,
    }) as Record<string, unknown>
  ).map(([k, v]) => [k, typeof v === "string" ? v : String(v)])
);
let browserBuild: ReturnType<typeof buildLayer> | undefined;
const browserEntries = () => [...clientIds, BROWSER_RUNTIME];
const buildBrowser = () =>
  (browserBuild ??= shareLayer(
    "browser",
    browserEntries(),
    (outdir, inputs) =>
      buildLayer("browser", browserEntries(), {
        define: {
          ...clientDefine,
          // ブラウザ用の Flight クライアントは webpack のランタイム（__webpack_require__ と __webpack_chunk_load__）でモジュールを読む
          __webpack_chunk_load__: "globalThis.__proofyardBrowserChunkLoad",
          __webpack_require__: "globalThis.__proofyardBrowserRequire",
          "globalThis.__next_require__": "globalThis.__proofyardBrowserRequire",
          // React の act（Testing Library が使う）は開発版にしかないので、ブラウザ層の React だけ開発版にする（Jest などと同じ）。
          // Next.js 自身の他の define は本番のまま
          "process.env.NODE_ENV": '"development"',
        },
        inputs,
        outdir,
        redirect: browserRedirect,
        style,
        transform: swcTransformFor("browser"),
      }),
    true
  ));
// Client Reference が揃ったら、SSR 層と同時にビルドを始める（待つのはテストが始まる前。prerender の別プロセスは作らない）
// （失敗はそこで待つときに出す。先に失敗しても未処理の拒否にしない）
const browserStarted = performance.now();
let browserTook = 0;
if (!BUILD_OUTPUT) {
  buildBrowser()
    .then(() => (browserTook = performance.now() - browserStarted))
    .catch(() => {
      // 失敗はテストの前に待つところで出す
    });
}

// renderRoute の Client Mode: Next.js 本体のクライアント（app-next.js）と Client Component を 1 つのファイルにまとめる。
// バンドル全体を 1 つの関数（createRoute）で包み、renderRoute のたびに呼ぶ（ルーターなどのモジュールの状態をテストごとに新しくする）。
// ファイルの解析は 1 回で、JSC の最適化もテストをまたいで効く（以前はクエリ付きで import し直していて、毎回の解析と最適化のやり直しで 1 テストあたり数倍遅かった）
// next build のブラウザ向けと同じく本番版（React も本番版なので act はない。表示は findBy / waitFor で待つ）
// instrumentation-client: Next.js のローダーが書く、設定の instrumentationClientInject とアプリのファイルを読むモジュール。
// アプリのファイルは private-next-instrumentation-client-user（src/ を先に探す。なければ空のモジュール）
const INSTRUMENTATION_CLIENT = join(work, "instrumentation-client.js");
const instrumentationClientUser =
  ["src/instrumentation-client", "instrumentation-client"]
    .flatMap((name) =>
      pageExtensions.map((ext) => join(projectDir, `${name}.${ext}`))
    )
    .find((file) => existsSync(file)) ??
  join(import.meta.dir, "../client/empty-module.js");
const instrumentationClientCode: string =
  await require("next/dist/build/webpack/loaders/next-instrumentation-client-loader").default.call(
    {
      getOptions: () => ({
        modules: config.instrumentationClientInject ?? [],
      }),
      // oxlint-disable-next-line require-await -- webpack の getResolve は Promise を返す（解決は同期）
      getResolve: () => async (context: string, request: string) =>
        Bun.resolveSync(request, context),
      rootContext: projectDir,
    }
  );

write(
  INSTRUMENTATION_CLIENT,
  instrumentationClientCode.replace(
    /(?<quote>["'])private-next-instrumentation-client-user\k<quote>/u,
    JSON.stringify(instrumentationClientUser)
  )
);

const ROUTE_ENTRY = join(work, "route-entry.js");
const writeRouteEntry = (asyncIds: Set<string>) =>
  write(
    ROUTE_ENTRY,
    [
      // webpack のランタイムの代わり（Flight クライアントが Client Reference のモジュールを読む）
      "const modules = {",
      // async module（top-level await）は import() で読み、同じ Promise を返す（Flight クライアントが状態を書き込んで待つ）
      ...[...clientIds].map(
        (id) =>
          `  ${JSON.stringify(id)}: () => ${asyncIds.has(id) ? "import" : "require"}(${JSON.stringify(id)}),`
      ),
      "};",
      "const loaded = {};",
      "globalThis.__proofyardRouteRequire = Object.assign((id) => {",
      // oxlint-disable-next-line no-template-curly-in-string -- 生成するコードのテンプレートリテラル
      "  if (!(id in modules)) throw new Error(`[proofyard] unknown client module ${id}`);",
      "  return id in loaded ? loaded[id] : (loaded[id] = modules[id]());",
      "}, { u: (chunkId) => chunkId });",
      "globalThis.__proofyardRouteChunkLoad = () => Promise.resolve();",
      `require(${JSON.stringify(join(nextDist, "client/app-next.js"))});`,
    ].join("\n")
  );
const buildRoute = async (
  outdir: string,
  inputs: Set<string>,
  asyncIds: Set<string>
) => {
  writeRouteEntry(asyncIds);
  const outputs = await buildLayer("browser", [ROUTE_ENTRY], {
    aliases: {
      "next/dist/client/app-call-server": undefined,
      "private-next-instrumentation-client": INSTRUMENTATION_CLIENT,
      "react-dom/client": join(
        import.meta.dir,
        "../client/route-react-dom-client.ts"
      ),
      "react-dom/test-utils": undefined,
      "react-server-dom-webpack/client":
        "next/dist/compiled/react-server-dom-webpack/client",
    },
    define: {
      ...clientDefine,
      __webpack_chunk_load__: "globalThis.__proofyardRouteChunkLoad",
      __webpack_require__: "globalThis.__proofyardRouteRequire",
      // クライアントの通信（RSC の取得、Server Actions）はメモリ内の Next.js の handler へ（src/testing/render-route.ts）
      fetch: "globalThis.__proofyardRouteFetch",
      "globalThis.__next_require__": "globalThis.__proofyardRouteRequire",
      // ハイドレーションの完了を window.__NEXT_HYDRATED_CB で知らせる（Next.js 自身のテストと同じ）
      "process.env.__NEXT_TEST_MODE": "true",
    },
    inputs,
    outdir,
    redirect: browserRedirect,
    splitting: false,
    style,
    transform: swcTransformFor("route"),
  });
  const out = outputs.get(ROUTE_ENTRY)!;
  const code = readFileSync(out, "utf-8").trimEnd();
  const tail = "export default require_route_entry();";
  if (!code.endsWith(tail)) {
    throw new Error(`[proofyard] the route bundle does not end with ${tail}`);
  }
  const factory = out.replace(/\.js$/u, ".factory.js");
  write(
    factory,
    `export default function createRoute() {\n${code.slice(0, -tail.length)}\nreturn require_route_entry();\n}\n`
  );
  return new Map([[ROUTE_ENTRY, factory]]);
};
const SSR_RUNTIME = join(import.meta.dir, "ssr-runtime.ts");
const ssrEntries = [...clientIds, SSR_RUNTIME];
const ssr = await shareLayer(
  "ssr",
  ssrEntries,
  (outdir, inputs) =>
    buildLayer("ssr", ssrEntries, {
      define,
      inputs,
      outdir,
      style,
      transform: swcTransformFor("ssr"),
    }),
  true
);
lap("ssr build");

// ネイティブで読み込むアプリ（と、その依存）の rsc 層の解決と変換
// - react などは Next.js 内蔵の React に（build.module は CJS の require も含めて置き換える）
// - アプリのソースは SWC で変換し、"use client" は Client Reference に
const withoutRestore = (path: string) =>
  path.replace(/\?proofyard-restore=\d+$/u, "");
const escape = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
Bun.plugin({
  name: "proofyard-next-rsc-native",
  setup(build) {
    for (const [spec, target] of Object.entries(ALIASES.rsc)) {
      build.module(spec, () => ({
        exports: require(Bun.resolveSync(target, process.cwd())),
        loader: "object",
      }));
    }
    for (const [spec, file] of nextFacades)
    // CJS は名前付きの export が module.exports、ESM（next/dist/api/* など）は名前付きの export。webpack と同じ形にまとめる
    {
      build.module(spec, () => {
        const m = require(rsc.get(facadeEntries.get(file)!)!).default;
        const cjs =
          m.default !== null && typeof m.default === "object" ? m.default : {};
        // default は、__esModule の付いた CJS（SWC / Babel の出力）なら exports.default（next/image など）
        const exports = {
          ...m,
          ...cjs,
          default: cjs.__esModule ? cjs.default : m.default,
        };
        // SWC の "use server" の変換結果が呼ぶ。Action の id → 関数を記録する（src/testing/actions.ts）
        if (spec === "private-next-rsc-server-reference") {
          const register = exports.registerServerReference;
          exports.registerServerReference = (
            action: ServerActionFunction,
            id: string,
            exportName: string | null
          ) => {
            serverActions.set(id, action);
            return register(action, id, exportName);
          };
        }
        return { exports, loader: "object" };
      });
    }
    build.onLoad({ filter: STYLE_FILE }, (args) => style(args.path));
    // ?proofyard-restore=N は mock.module を戻すときの読み込み直し（下）
    // onLoad で undefined を返しても元の読み込みに戻らないので、対象のパスを列挙した filter にする。
    // 1 本の正規表現にまとめると大きすぎて作れない（"use client" の多いライブラリでは数万件）ので分けて登録する
    // （否定の先読み (?!...) は filter では効かず、アプリの下の node_modules にも当たる）
    const onLoadPaths = (paths: string[], load: (path: string) => string) => {
      const escaped = paths.map(escape);
      for (let i = 0; i < escaped.length; i += 500) {
        build.onLoad(
          {
            // oxlint-disable-next-line require-unicode-regexp -- Bun のプラグインの filter は Bun が自前で解釈するので、フラグを付けない
            filter: new RegExp(
              `^(?:${escaped.slice(i, i + 500).join("|")})(?:\\?proofyard-restore=\\d+)?$`
            ),
          },
          (args) => ({
            contents: load(withoutRestore(args.path)),
            loader: "js",
          })
        );
      }
    };
    onLoadPaths([...nativeReplacements.keys()], (path) =>
      nativeReplacements.get(path)!
    );
    // ponytail: 起動時にあるファイルだけ。起動後に増えたファイルはプラグインを通らない（bun test --watch は起動し直すので足りる）
    onLoadPaths([...appSources(projectDir, /\.[jt]sx?$/u)], (path) => {
      const source = readFileSync(path, "utf-8");
      return USE_CLIENT.test(source)
        ? clientReferenceStub(path, source)
        : swcTransformSync(path, source);
    });
  },
});
// bun test --watch: Bun はランタイムのプラグインの onLoad で読んだファイル（上のアプリのソース・スタイル）を監視しない（oven-sh/bun#5844）。
// 層のバンドル（Bun.build）にだけ入るファイル（Client Component など）も監視しない。アプリのソースとスタイルを、プラグインを通らない
// パス（クエリ付き）でテキストとして読み込んで、Bun に監視させる（コードは実行しない。--watch かどうかは分からないので毎回）
await Promise.all(
  [...appSources(projectDir, /\.(?:[cm]?[jt]sx?|css|scss|sass)$/u)].map(
    (file) => import(`${file}?proofyard-watch`, { with: { type: "text" } })
  )
);
lap("other");
console.log(
  `[proofyard] rsc+ssr layers: ${(performance.now() - t).toFixed(0)}ms${debug ? ` (${laps.join(", ")})` : ""}, client references: ${clientIds.size}`
);
t = performance.now();

// SSR 層の Client Component（webpack の require と同じく CJS は module.exports、ESM は名前空間）
const ssrModules = new Map<string, unknown>();
for (const [id, out] of ssr) {
  // oxlint-disable-next-line no-await-in-loop -- 読み込みの順（評価の副作用の順）を変えない
  const m = await import(out);
  ssrModules.set(
    id,
    esmClientIds.has(id) || id === SSR_RUNTIME ? m : m.default
  );
}
// Next.js の handler が Server Action を読むモジュール（server-reference-manifest.json の moduleId）。
// webpack ではファイルの Action を id の名前で export するモジュール（next-flight-action-entry-loader）
const ACTION_FILE_PREFIX = "proofyard-server-action-file:";
// rsc 層の Flight クライアント（prerender や "use cache" の結果を rsc 層で読み直す）が読む Client Component は、
// next build の rscModuleMapping と同じく rsc 層のモジュール（Client Reference）
const RSC_CLIENT_PREFIX = "proofyard-rsc-client:";
const { createClientModuleProxy, registerClientReference } = require(
  Bun.resolveSync(ALIASES.rsc["react-server-dom-webpack/server"], process.cwd())
);
const rscClientModules = new Map<string, object>();
const rscClientModule = (id: string) => {
  let m = rscClientModules.get(id);
  if (!m) {
    // registerClientReference は渡した関数に $$id などを書き込むので、Client Reference ごとに作る
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- 同上（共有すると $$id が上書きされる）
    const fail = () => {
      throw new Error("[proofyard] client function called on the server");
    };
    // CommonJS は next-flight-loader と同じく createClientModuleProxy（default の import の "" も読める）
    m = esmClientIds.has(id)
      ? {
          __esModule: true,
          ...Object.fromEntries(
            (clientExports.get(id) ?? []).map((name) => [
              name,
              registerClientReference(fail, id, name),
            ])
          ),
        }
      : createClientModuleProxy(id);
    rscClientModules.set(id, m);
  }
  return m;
};
// Next.js の handler が呼ぶ Server Action の呼び出し（引数は decodeReply の後。.bind した引数を含む）を、テストごとに記録する（renderRoute の actions.getCalls）
const routeActionCalls: ActionCall[] = [];
const recordingActions = new WeakMap<
  ServerActionFunction,
  ServerActionFunction
>();
const recordingAction = (id: string) => {
  const action = serverActions.get(id);
  if (!action) {
    return;
  }
  let wrapped = recordingActions.get(action);
  if (!wrapped) {
    // 関数名（スタックトレースに出る）は元のまま
    // oxlint-disable-next-line func-name-matching -- 同上
    wrapped = function recording(this: unknown, ...args: unknown[]) {
      routeActionCalls.push({ args, id, name: action.name });
      return action.apply(this, args);
    };
    recordingActions.set(action, wrapped);
  }
  return wrapped;
};
(globalThis as any).__proofyardNextRequire = (id: string) => {
  if (id.startsWith(RSC_CLIENT_PREFIX)) {
    return rscClientModule(id.slice(RSC_CLIENT_PREFIX.length));
  }
  if (id.startsWith(ACTION_FILE_PREFIX)) {
    require(id.slice(ACTION_FILE_PREFIX.length));
    // React の decodeAction（JS なしのフォームの送信）は hasOwnProperty で確かめてから読む
    const action = (actionId: string | symbol) =>
      typeof actionId === "string" ? recordingAction(actionId) : undefined;
    return new Proxy(
      {},
      {
        get: (_, actionId) => action(actionId),
        getOwnPropertyDescriptor: (_, actionId) => {
          const value = action(actionId);
          return (
            value && {
              configurable: true,
              enumerable: true,
              value,
              writable: false,
            }
          );
        },
        has: (_, actionId) => !!action(actionId),
      }
    );
  }
  // renderRSC の Client Reference（実行しない代わりのモジュール。src/testing/render-rsc.ts）
  // Server Action（decodeReply が引数の中の Server Reference を読むとき）
  const action = actionModule(id);
  if (action) {
    return action;
  }
  const placeholder = (globalThis as any)[
    Symbol.for("proofyard.clientReferencePlaceholder")
  ]?.(id);
  if (placeholder) {
    return placeholder;
  }
  if (!ssrModules.has(id)) {
    throw new Error(`[proofyard] unknown client module ${id}`);
  }
  return ssrModules.get(id);
};

// `next start` が読む .next（route-module.ts の loadManifests）
const randomKey = () => randomBytes(32).toString("hex");
const preview = {
  previewModeEncryptionKey: randomKey(),
  previewModeId: randomKey(),
  previewModeSigningKey: randomKey(),
};
// top-level await のある Client Component（推移的な依存を含む）。Next.js（webpack）は async module として manifest の async を true にし、
// Flight クライアントは __webpack_require__ が返す Promise を待つ。SSR 層は読み込み済み（上）なので、同期で返したままでよい
// ponytail: SSR 層の出力（Bun の出力は最上位の文が行頭から始まる）で、行頭の await を、チャンクの import をたどって探す。ブラウザ層だけの依存は見ない
const TOP_LEVEL_AWAIT =
  /^(?:await\b|for await\b|(?:var|let|const) [^\n]*?= await\b)/mu;
const asyncOutputs = new Map<string, boolean>();
const isAsyncOutput = (file: string): boolean => {
  if (!asyncOutputs.has(file)) {
    // 循環
    asyncOutputs.set(file, false);
    const code = readFileSync(file, "utf-8");
    asyncOutputs.set(
      file,
      TOP_LEVEL_AWAIT.test(code) ||
        [...code.matchAll(/(?:from|import)\s*"(?<spec>\.\.?\/[^"]+)"/gu)].some(
          ([, spec]) => isAsyncOutput(join(dirname(file), spec!))
        )
    );
  }
  return asyncOutputs.get(file)!;
};
const asyncClientIds = new Set(
  [...clientIds].filter((id) => isAsyncOutput(ssr.get(id)!))
);
// renderRoute のバンドルは async な Client Component（top-level await）を知ってから作る（SSR 層と同時に作ると、Mac では CPU を取り合って遅くなった）。
// next build の prerender のプロセス（buildOutput）はブラウザ層を使わないので作らない
const routeStarted = performance.now();
// （キャッシュの入力を比べるので、入口は先に書いておく）
if (!BUILD_OUTPUT) {
  writeRouteEntry(asyncClientIds);
}
const routeBuild = BUILD_OUTPUT
  ? undefined
  : shareLayer(
      "route",
      [ROUTE_ENTRY],
      (outdir, inputs) => buildRoute(outdir, inputs, asyncClientIds),
      true
    ).then((outputs) => outputs.get(ROUTE_ENTRY)!);
// 失敗はテストの前に待つところで出す
routeBuild?.catch(() => {
  // 失敗はテストの前に待つところで出す
});
const clientEntry = (id: string) => ({
  async: asyncClientIds.has(id),
  chunks: [],
  id,
  name: "*",
});
const clientReferenceManifest = {
  clientModules: Object.fromEntries(
    [...clientIds].map((id) => [id, clientEntry(id)])
  ),
  edgeRscModuleMapping: {},
  edgeSSRModuleMapping: {},
  entryCSSFiles: {},
  entryJSFiles: {},
  moduleLoading: { crossOrigin: null, prefix: "" },
  rscModuleMapping: Object.fromEntries(
    [...clientIds].map((id) => [
      id,
      { "*": clientEntry(RSC_CLIENT_PREFIX + id) },
    ])
  ),
  ssrModuleMapping: Object.fromEntries(
    [...clientIds].map((id) => [id, { "*": clientEntry(id) }])
  ),
};
write(join(distDir, "BUILD_ID"), "proofyard");
// ルートの一覧と next.config の redirects / rewrites / headers（next build と同じ生成処理。build/index.ts）
const { routesManifest } = generateRoutesManifest({
  appType: "app",
  config,
  deploymentId: config.deploymentId,
  headers: customRoutes.headers,
  isAppPPREnabled: !!config.cacheComponents,
  onMatchHeaders: customRoutes.onMatchHeaders,
  pageKeys: { app: appPaths, pages: [] },
  redirects: customRoutes.redirects,
  restrictedRedirectPaths: ["/_next"].map((p) =>
    config.basePath ? `${config.basePath}${p}` : p
  ),
  rewrites: customRoutes.rewrites,
});
write(join(distDir, "routes-manifest.json"), routesManifest);
// ページのモジュール（next start は server/app/<page>.js を require する）は rsc 層のビルド結果
write(
  join(distDir, "server/app-paths-manifest.json"),
  Object.fromEntries(
    [...routes.values()].map(({ page }) => [page, `app${page}.js`])
  )
);
write(
  join(distDir, "app-path-routes-manifest.json"),
  Object.fromEntries(
    [...routes].map(([pathname, { page }]) => [page, pathname])
  )
);
// top-level await のあるモジュールに依存するエントリ（async module）は require できない。Next.js は webpack の async module の
// エントリ（module.exports が Promise）を待つので、import() の Promise にする（require に失敗した時点で評価は始まっていて、import() はその続きを待つ）
const requireEntry = (entry: string, then = "") =>
  `const load = (mod) => mod${then};\ntry {\n  module.exports = load(require(${JSON.stringify(rsc.get(entry))}));\n} catch (error) {\n` +
  `  if (!String(error).includes("require() async module")) throw error;\n  module.exports = import(${JSON.stringify(rsc.get(entry))}).then(load);\n}\n`;
for (const { page, entry } of routes.values()) {
  write(
    join(distDir, `server/app${page}.js`),
    requireEntry(
      entry,
      " && (mod.__proofyardEntryBase ? { ...mod.__proofyardEntryBase, ...mod } : mod)"
    )
  );
}
write(join(distDir, "server/pages-manifest.json"), {});
mkdirSync(join(distDir, "static"), { recursive: true });
write(join(distDir, "server/middleware-manifest.json"), {
  functions: {},
  middleware: {},
  sortedMiddleware: [],
  version: 3,
});
// Node.js の Proxy は server/middleware.js（next-server.ts の loadNodeMiddleware）。matcher は functions-config-manifest に
write(join(distDir, "server/functions-config-manifest.json"), {
  functions: middlewareEntry
    ? { "/_middleware": { matchers: middlewareMatchers, runtime: "nodejs" } }
    : {},
  version: 1,
});
if (middlewareEntry) {
  write(join(distDir, "server/middleware.js"), requireEntry(middlewareEntry));
}
// instrumentation は server/instrumentation.js（getInstrumentationModule）。register / onRequestError は Next.js 本体が呼ぶ
if (instrumentationEntry) {
  write(
    join(distDir, "server/instrumentation.js"),
    requireEntry(instrumentationEntry)
  );
}
// routes / dynamicRoutes / notFoundRoutes は、プリロードの最後で next build と同じものにする（collectBuildOutput）
const prerenderManifest = {
  dynamicRoutes: {} as Record<string, any>,
  notFoundRoutes: [] as string[],
  preview,
  routes: {} as Record<string, any>,
  version: 4,
};
write(join(distDir, "prerender-manifest.json"), prerenderManifest);
write(join(distDir, "server/preview-props.json"), preview);
write(join(distDir, "build-manifest.json"), {
  devFiles: [],
  lowPriorityFiles: [],
  pages: { "/_app": [] },
  polyfillFiles: [],
  rootMainFiles: ["static/chunks/main-app.js"],
});
write(join(distDir, "server/next-font-manifest.json"), nextFontManifest);
const serverActionsManifest = {
  edge: {},
  encryptionKey,
  node: Object.fromEntries(
    [...actionFiles].map(([id, path]) => [
      id,
      {
        filename: relative(projectDir, path),
        layer: Object.fromEntries(
          [...routes.values()].map(({ page }) => [`app${page}`, "rsc"])
        ),
        workers: Object.fromEntries(
          [...routes.values()].map(({ page }) => [
            `app${page}`,
            { async: false, moduleId: ACTION_FILE_PREFIX + path },
          ])
        ),
      },
    ])
  ),
};
write(
  join(distDir, "server/server-reference-manifest.json"),
  serverActionsManifest
);
write(join(distDir, "required-server-files.json"), {
  appDir: projectDir,
  config,
  files: [],
  ignore: [],
  relativeAppDir: "",
  version: 1,
});
for (const { page } of routes.values()) {
  write(
    join(distDir, `server/app${page}_client-reference-manifest.js`),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST[${JSON.stringify(page)}] = ${JSON.stringify(clientReferenceManifest)};\n`
  );
}

// リクエストの外（renderRSC / render）で描画するときの manifest。リクエストの処理中は Next.js 自身が設定し直す。
// クロージャの Server Action の値の暗号化（encryption.ts）がここから鍵を読む
require(
  rsc.get(facadeEntries.get(MANIFESTS_SINGLETON)!)!
).default.setManifestsSingleton({
  clientReferenceManifest,
  page: "/_proofyard/page",
  serverActionsManifest,
});

export interface RequestRouteOptions {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: BodyInit | null;
}

// next start のルーター（Proxy、next.config の redirects / rewrites / headers、ルートの解決）
let router: Promise<(req: unknown, res: unknown) => Promise<void>> | undefined;
const getRouter = () =>
  (router ??= (async () => {
    const { initialize } = require("next/dist/server/lib/router-server");
    // 設定は読み込み済みのものを渡す（distDir は一時ディレクトリ。standalone の server.js と同じ仕組み）
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify({
      ...config,
      distDir: relative(projectDir, distDir),
    });
    try {
      const { requestHandler } = await initialize({
        dev: false,
        dir: projectDir,
        hostname: "localhost",
        minimalMode: false,
        onDevServerCleanup: undefined,
        port: 80,
        quiet: false,
      });
      // prerender-manifest にないルートで ?__nextppronly を使えるようにする（next start の --experimental-test-proxy と同じ。
      // app-page-runtime.ts でこの値を見るのは、その判定だけ）
      if (config.cacheComponents) {
        (globalThis as any)[Symbol.for("@next/router-server-methods")][
          relative(process.cwd(), projectDir)
        ].experimentalTestProxy = true;
      }
      return requestHandler;
    } finally {
      delete process.env.__NEXT_PRIVATE_STANDALONE_CONFIG;
    }
  })());

const sendRoute = async (
  url: string,
  init: RequestRouteOptions = {}
): Promise<Response> => {
  const handler = await getRouter();
  // 本文と content-type（FormData の boundary など）は Request に作らせる
  const request = new Request(new URL(url, "http://localhost"), {
    body: init.body,
    headers: { host: "localhost", ...init.headers },
    method: init.method,
  });
  if (init.cookies) {
    const cookie = Object.entries(init.cookies).map(
      ([k, v]) => `${k}=${encodeURIComponent(v)}`
    );
    request.headers.set(
      "cookie",
      [request.headers.get("cookie"), ...cookie].filter(Boolean).join("; ")
    );
  }
  const body = request.body
    ? Buffer.from(await request.arrayBuffer())
    : undefined;
  // 本文はストリームで返す（ブラウザと同じく、Suspense の fallback などが先に届く）。
  // ステータスとヘッダーは、Node.js と同じく最初の書き込み（または終わり）の時点のもの
  // oxlint-disable-next-line typescript/no-invalid-void-type -- 値のない合図（resolve() を引数なしで呼ぶ）
  const head = Promise.withResolvers<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });
  let written = false;
  const { req, res } = createRequestResponseMocks({
    headers: Object.fromEntries(request.headers),
    method: request.method,
    resWriter: (chunk: Uint8Array | string) => {
      written = true;
      head.resolve();
      controller.enqueue(
        typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk)
      );
      return true;
    },
    url,
  });
  // MockedRequest の bodyReadable は、その _read を呼ぶだけで req にデータが流れない。本文は req 自身に流す
  if (body) {
    req._read = function _read(this: Readable) {
      this.push(body);
      this.push(null);
    };
  }
  let failure: { error: unknown } | undefined;
  // 失敗は then の 2 つ目の関数で受け取る（controller.close() の失敗は受け取らない）
  // oxlint-disable-next-line promise/catch-or-return -- 同上
  handler(req, res)
    .then(() => res.hasStreamed)
    .then(
      () => controller.close(),
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- 応答を返した後も続くので待たない
      (error) => {
        failure = { error };
        controller.error(error);
      }
    )
    .finally(head.resolve);
  await head.promise;
  if (failure && !written) {
    throw failure.error;
  }
  const nullBody = [101, 204, 205, 304].includes(res.statusCode);
  return new Response(nullBody ? null : stream, {
    headers: res.headers,
    status: res.statusCode,
  });
};

// next build の prerender の結果（prerender-manifest にあるページの静的な部分。next start はそれをファイルから読む）を、
// テストの中でそのページが最初にリクエストされたときに作る（テストの後に捨てる。resetCache）。
// 作り方は Next.js 本体に任せる: セグメントの先読みのリクエスト（/_tree）で、next start が結果のないページに対してするのと同じく
// 静的な部分だけを prerender させ（動的な部分は再開しないので、その副作用はない）、ファイル（distDir/server/route-cache）に書かせる。
// next start の起動直後と同じく、そのページの結果はメモリーから消してファイルから読ませる（PPR のページはファイルの .rsc を読まないなど）
const warmed = new Map<string, Promise<void>>();
const warmBuildOutput = async (url: string) => {
  const pathname = decodeURIComponent(
    new URL(url, "http://localhost").pathname
  );
  const prerendered =
    pathname in prerenderManifest.routes ||
    Object.values(prerenderManifest.dynamicRoutes).some(({ routeRegex }) =>
      // oxlint-disable-next-line require-unicode-regexp -- Next.js が作った正規表現（next start と同じく、フラグなしで使う）
      new RegExp(routeRegex).test(pathname)
    );
  if (!prerendered) {
    return;
  }
  if (!warmed.has(pathname)) {
    warmed.set(
      pathname,
      (async () => {
        const {
          computeCacheBustingSearchParam,
        } = require("next/dist/shared/lib/router/utils/cache-busting-search-param");
        const headers = {
          "next-router-prefetch": "1",
          "next-router-segment-prefetch": "/_tree",
          rsc: "1",
        };
        const response = await sendRoute(
          `${pathname}?_rsc=${await computeCacheBustingSearchParam("1", "/_tree", undefined, undefined)}`,
          { headers }
        );
        await response.arrayBuffer();
        // キャッシュのキーは /route-cache/APP_PAGE/<ルート>/$<パス>（"/" は /index）
        const memory =
          require("next/dist/server/lib/incremental-cache/memory-cache.external").getMemoryCache(
            config.cacheMaxMemorySize
          );
        const paths = new Set(
          [
            ...Object.keys(prerenderManifest.routes),
            ...Object.keys(prerenderManifest.dynamicRoutes),
          ].map((path) => (path === "/" ? "/index" : path))
        );
        // 消しながら回すので、先に写す
        // oxlint-disable-next-line unicorn/no-useless-spread -- 同上
        for (const [key, entry] of [...memory]) {
          if (
            entry?.value?.kind === "APP_PAGE" &&
            paths.has(key.slice(key.indexOf("/$") + 2))
          ) {
            memory.remove(key);
          }
        }
      })()
    );
  }
  await warmed.get(pathname);
};
// URL へのリクエストを Next.js 本体のルーター（next start と同じ router-server）で処理し、HTTP の応答を返す
const requestRoute = async (
  url: string,
  init: RequestRouteOptions = {}
): Promise<Response> => {
  await warmBuildOutput(url);
  return sendRoute(url, init);
};
// Partial Prerendering の静的シェル（仕様 12 章）。Next.js の静的シェルのデバッグ機能（?__nextppronly=1。app-page-runtime.ts）で、
// next build と同じ prerender（isBuildTimePrerendering）を走らせ、動的な部分を再開（resume）せずにシェルだけを返させる
export interface PrerenderRouteResult {
  status: number;
  // 静的シェルの HTML（next build の .html と同じ。Next.js がデバッグ用に </body></html> を足している）
  shell: string;
  // 動的な部分があり、リクエストのときに再開される（x-nextjs-postponed）
  postponed: boolean;
  // リクエストのときまで待つ Suspense 境界（シェルでは fallback が出ている）の id
  dynamicBoundaries: string[];
}
const {
  isDynamicRoute,
} = require("next/dist/shared/lib/router/utils/is-dynamic");
const { format } = require("node:util");
const { ENCODED_TAGS } = require("next/dist/server/stream-utils/encoded-tags");
// Next.js の StaticPathsResult（build/static-paths/types.ts。next build の isPageStatic と同じ buildAppStaticPaths の結果）。
// next build が prerender する URL（generateStaticParams）を、next dev と同じ Next.js の loadStaticPaths で求める。
// loadStaticPaths は globalThis.__incrementalCache を作り直すので、ルーターのものに戻す（next build の prerender のプロセスはルーターを使わない）
const staticPathsResult = async (path: string): Promise<any> => {
  if (!BUILD_OUTPUT) {
    await getRouter();
  }
  const {
    loadStaticPaths,
  } = require("next/dist/server/dev/static-paths-worker");
  const g = globalThis as any;
  const incrementalCache = g.__incrementalCache;
  try {
    const result = await loadStaticPaths({
      authInterrupts: !!config.experimental.authInterrupts,
      buildId: "proofyard",
      cacheHandler: config.cacheHandler,
      cacheHandlers: config.cacheHandlers,
      cacheLifeProfiles: config.cacheLife,
      cacheMaxMemorySize: config.cacheMaxMemorySize,
      config: {
        cacheComponents: !!config.cacheComponents,
        configFileName: config.configFileName,
        partialPrefetching: !!config.partialPrefetching,
      },
      deploymentId: config.deploymentId ?? "",
      dir: projectDir,
      distDir,
      durableUseCacheEntries: !!config.experimental.durableUseCacheEntries,
      fetchCacheKeyPrefix: config.experimental.fetchCacheKeyPrefix,
      httpAgentOptions: config.httpAgentOptions,
      isAppPath: true,
      isrFlushToDisk: false,
      nextConfigOutput: config.output,
      page: routes.get(path)!.page,
      pathname: path,
      requestHeaders: {},
      sriEnabled: !!config.experimental.sri?.algorithm,
      staticPageGenerationTimeout: config.staticPageGenerationTimeout,
      useCacheTimeout: config.experimental.useCacheTimeout,
    });
    return result;
  } finally {
    g.__incrementalCache = incrementalCache;
  }
};

// サーバー側の、テストのオリジン（http://localhost）への fetch はメモリ内の handler へ。
// Next.js は Server Action の redirect 先の RSC を自分自身に fetch して取る（action-handler.ts の createRedirectRenderResult）。
// Next.js の fetch のパッチ（patchFetch）より先に入れる
// ponytail: http://localhost（80 番）で本物のサーバーを動かすテストとはぶつかる。必要になったらオリジンを設定にする
const nativeFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "http://localhost") {
      return nativeFetch(input, init);
    }
    const response = await requestRoute(url.pathname + url.search, {
      body: request.body ? await request.arrayBuffer() : undefined,
      headers: Object.fromEntries(request.headers),
      method: request.method,
    });
    Object.defineProperty(response, "url", { value: url.href });
    return response;
  },
  nativeFetch
);

// アプリのキャッシュ（"use cache" のハンドラーとタグの無効化記録）はテストごとに分離する。
// ハンドラーは次のリクエストで Next.js 自身が作り直す（use-cache/handlers.ts の initializeCacheHandlers）
const {
  tagsManifest,
} = require("next/dist/server/lib/incremental-cache/tags-manifest.external");

const resetCache = () => {
  const g = globalThis as any;
  if (g[Symbol.for("@next/cache-handlers")]) {
    throw new Error(
      "[proofyard] Unsupported: custom cacheHandlers cannot be isolated between tests by the current runtime"
    );
  }
  for (const name of [
    "@next/cache-handlers-map",
    "@next/cache-handlers-set",
    "@next/cache-handlers-built-in",
  ]) {
    // oxlint-disable-next-line typescript/no-dynamic-delete -- Next.js が globalThis に置く Symbol のキー
    delete g[Symbol.for(name)];
  }
  tagsManifest.clear();
  const memory =
    require("next/dist/server/lib/incremental-cache/memory-cache.external").getMemoryCache(
      config.cacheMaxMemorySize
    );
  // unstable_cache と fetch のキャッシュ（FETCH。ファイルは distDir/cache/fetch-cache）
  // 消しながら回すので、先に写す
  // oxlint-disable-next-line unicorn/no-useless-spread -- 同上
  for (const [key, entry] of [...memory]) {
    if (entry?.value?.kind === "FETCH") {
      memory.remove(key);
    }
  }
  rmSync(join(distDir, "cache/fetch-cache"), { force: true, recursive: true });
  // テストの中で作った build の結果（warmBuildOutput）を捨てる
  if (warmed.size) {
    warmed.clear();
    // oxlint-disable-next-line unicorn/no-useless-spread -- 消しながら回すので、先に写す
    for (const [key, entry] of [...memory]) {
      if (entry?.value?.kind === "APP_PAGE") {
        memory.remove(key);
      }
    }
    rmSync(join(distDir, "server/route-cache"), {
      force: true,
      recursive: true,
    });
  }
};
// 無効化されたタグ（revalidateTag / updateTag / revalidatePath が記録したもの）
const invalidatedTags = (): string[] => [...tagsManifest.keys()];

// after() の処理は Next.js が waitUntil に渡す。プラットフォームが waitUntil を渡す入口（"@next/request-context"。Vercel などが使う）で受け取り、
// flushAfter() で終わるまで待てるようにする（next start では Next.js 内部の AwaiterOnce が受け取る。どちらも渡された Promise を待つだけ）
const pendingAfter = new Set<Promise<unknown>>();
(globalThis as any)[Symbol.for("@next/request-context")] = {
  get: () => ({
    waitUntil: (promise: Promise<unknown>) => {
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- 待たずに失敗を記録する
      const task = Promise.resolve(promise).catch((error) =>
        console.error(error)
      );
      pendingAfter.add(task);
      // oxlint-disable-next-line promise/catch-or-return -- task は catch 済みで拒否されない
      task.finally(() => pendingAfter.delete(task));
    },
  }),
};
const flushAfter = async () => {
  // after() の中で after() を呼ぶと増える
  while (pendingAfter.size > 0) {
    // oxlint-disable-next-line no-await-in-loop -- 待つ間に増えたものをまた待つ
    await Promise.all(pendingAfter);
  }
};
const { afterAll, afterEach, beforeEach, mock } = await import("bun:test");

// mock.module の差し替えは、テストの中ならテストの後、ファイルの直下ならファイルの後に戻す（仕様 19 章の Mock State）。
// Bun は戻さない（mock.restore() も）。戻すときは本物を別のキー（?proofyard-restore=N）で読み込み直し、その中身で差し替える。
// 差し替えるときには読み込まない（Bun は読み込みの失敗を覚えていて、後で差し替えても同じエラーになる。server-only などが差し替えられなくなる）。
// ponytail: 戻した後は読み込み直した別のインスタンス（モジュールの状態は初期に戻り、読み込みの副作用はもう一度起きる）
// current: いまの差し替えの中身（テストの中の差し替えは、ファイルの直下の差し替えがあればそれに戻す）
interface Restore {
  key: string;
  names: string[];
  snapshot?: object;
  current?: object;
}
const testMocks = new Map<string, Restore>();
const fileMocks = new Map<string, Restore>();
const mockModule = mock.module;
let restores = 0;
let fileRestoreRegistered = false;
let testsStarted = 0;
// 同じプロセスで同時に動くテスト（test.concurrent / --concurrent）は、DOM とキャッシュの分離（仕様 20.4）ができないので Fail Closed。
// 並列にするならプロセスを分ける（--parallel）
let runningTests = 0;
const restoreMocks = (scope: Map<string, Restore>) => {
  const list = [...scope.values()];
  scope.clear();
  for (const { key, names, snapshot } of list) {
    let exports: object;
    try {
      const current =
        (scope === testMocks && fileMocks.get(key)?.current) || snapshot;
      if (current) {
        exports = current;
      } else {
        const restoreIndex = restores;
        restores += 1;
        exports = { ...require(`${key}?proofyard-restore=${restoreIndex}`) };
      }
    } catch (error) {
      // 本物を読み込めない（server-only など）。使うとそのエラーになる値にする（Bun は差し替えのときに値を読むので、getter で投げると戻せない）
      // ponytail: typeof と真偽の判定はエラーにならない（Proxy で止められない）
      const fail = new Proxy(
        // construct のトラップを使うので、アロー関数ではなく function（new できる関数）にする
        // oxlint-disable-next-line prefer-arrow-callback -- 同上
        function unavailable() {
          // 中身はトラップが投げる
        },
        Object.fromEntries(
          [
            "get",
            "apply",
            "construct",
            "has",
            "set",
            "ownKeys",
            "getPrototypeOf",
          ].map((trap) => [
            trap,
            () => {
              throw new Error(
                `[proofyard] ${key} was replaced by mock.module in an earlier test, and the real module cannot be loaded: ${error}`,
                { cause: error }
              );
            },
          ])
        )
      );
      exports = Object.fromEntries(names.map((name) => [name, fail]));
    }
    mockModule(key, () => exports);
  }
};
mock.module = (spec: string, factory: () => object | Promise<object>) => {
  // build.module の別名（react、next/* など）は、その名前のまま。本物はファイルではないので、先に写しておく
  const virtual =
    spec in ALIASES.rsc || nextFacades.has(spec) || spec === "next";
  const caller = /\(?(?<file>\/[^()]+?):\d+:\d+\)?$/u.exec(
    new Error("caller").stack!.split("\n")[2] ?? ""
  )?.[1];
  let key = spec;
  try {
    if (!virtual && caller) {
      key = Bun.resolveSync(spec, dirname(caller));
    }
  } catch {
    // 存在しないモジュールの差し替え
  }
  const scope = runningTests > 0 ? testMocks : fileMocks;
  if (scope === fileMocks && !fileRestoreRegistered) {
    // ファイルの読み込み中に登録した afterAll は、そのファイル（describe の中ならその describe）の後に動く。
    // プリロードの afterAll は全部のファイルの後に 1 回だけ。beforeAll の中で登録するとすぐに動くので、テストが始まっていなければ戻さない
    // ponytail: beforeAll の中の差し替えは、次のファイルの直下の差し替えか、全部のファイルの後まで残る
    fileRestoreRegistered = true;
    const started = testsStarted;
    afterAll(() => {
      fileRestoreRegistered = false;
      if (testsStarted > started) {
        restoreMocks(fileMocks);
      }
    });
  }
  const restore: Restore = scope.get(key) ?? {
    key,
    names: [],
    snapshot: virtual ? { ...require(spec) } : undefined,
  };
  scope.set(key, restore);
  const record = (m: object) => {
    restore.names = Object.keys(m);
    restore.current = m;
    return m;
  };
  return mockModule(key, () => {
    const result = factory();
    return result instanceof Promise ? result.then(record) : record(result);
  });
};
afterAll(() => restoreMocks(fileMocks));
// 生成物（エントリ、層のビルド、.next。layers.ts の出力もこの下）は、テストの後には消さず、次の実行の起動時に消す（上）。
// bun test は process の exit を出さない。afterAll で消すと、--watch では読み込んだファイルの変更として再実行が止まらず、
// --parallel --no-isolate では afterAll がファイルごとに動いて次のファイルが失敗する
beforeEach(() => {
  testsStarted += 1;
  runningTests += 1;
  if (runningTests > 1) {
    throw new Error(
      "[proofyard] Unsupported: concurrent tests in one process (test.concurrent / --concurrent) share the DOM and the app cache. Use --parallel"
    );
  }
  resetCache();
});
// テストごとに DOM を分離する（仕様 19 章）。render() の React のルートを外し（src/testing/render.ts）、body を空にする
afterEach(() => {
  runningTests -= 1;
  // 先にフォーカスを外す（turbo-dom は取り除いた要素を activeElement に残す。ブラウザなら body に戻る）
  if (typeof document !== "undefined") {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
  (globalThis as any)[Symbol.for("proofyard.cleanup")]?.();
  (globalThis as any)[Symbol.for("proofyard.routeCleanup")]?.();
  if (typeof document !== "undefined") {
    document.body.innerHTML = "";
  }
  routeActionCalls.length = 0;
  restoreMocks(testMocks);
});

let browser: Promise<typeof ClientRuntime> | undefined;
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
          if (!out) {
            throw new Error(`[proofyard] unknown client module ${id}`);
          }
          // async module（top-level await）は Promise を返す（route-entry.js と同じ）
          const exports = (m: any) => (esmClientIds.has(id) ? m : m.default);
          modules.set(
            id,
            asyncClientIds.has(id)
              ? import(out).then(exports)
              : exports(require(out))
          );
        }
        return modules.get(id);
      },
      { u: (chunkId: string) => chunkId }
    );
    // Client Reference のチャンクは空なので呼ばれない
    (globalThis as any).__proofyardBrowserChunkLoad = () => Promise.resolve();
    return import(outputs.get(BROWSER_RUNTIME)!);
  })());

const ssrRuntime = (): typeof SsrRuntime => ssrModules.get(SSR_RUNTIME) as any;
// SSR 層の Flight デコードの moduleMap（Client Reference の id → SSR 層のモジュール）
const ssrModuleMap = () =>
  Object.fromEntries(
    [...clientIds].map((id) => [
      id,
      { "*": { async: false, chunks: [], id, name: "*" } },
    ])
  );

// prerender-manifest の App Router のページの項目（build/index.ts の static-generation の後半と同じ。cacheComponents のアプリなので、
// どのページも Partial Prerendering）。next start が読む項目だけ作る（routeType などの分類、experimentalBypassFor、allowHeader、htmlSize は
// デプロイ先のアダプター向けで、next start は読まない）。prerender できなかったページ（next build なら失敗する）は入れない
// oxlint-disable-next-line complexity -- build/index.ts の処理をそのまま写している
const prerenderManifestRoutes = (
  exported: any,
  pages: [string, any][]
): Omit<BuildOutput, "prefetchHints" | "emptyStaticShells"> => {
  const {
    FallbackMode,
    fallbackModeToFallbackField,
  } = require("next/dist/lib/fallback");
  const { collectMeta } = require("next/dist/build/utils");
  const { normalizeRouteRegex } = require("next/dist/lib/load-custom-routes");
  const {
    getNamedRouteRegex,
  } = require("next/dist/shared/lib/router/utils/route-regex");
  const {
    sortPageObjects,
  } = require("next/dist/shared/lib/router/utils/sortable-routes");
  const {
    normalizePagePath,
  } = require("next/dist/shared/lib/page-path/normalize-page-path");
  const {
    isStaticMetadataFile,
  } = require("next/dist/lib/metadata/is-metadata-route");
  const routesOut: Record<string, unknown> = {};
  const dynamicRoutes: Record<string, unknown> = {};
  const getCacheControl = (
    path: string,
    defaultRevalidate: unknown = false
  ) => {
    const cacheControl = exported?.byPath.get(path)?.cacheControl;
    if (!cacheControl) {
      return { expire: undefined, revalidate: defaultRevalidate };
    }
    if (
      cacheControl.revalidate !== false &&
      cacheControl.revalidate > 0 &&
      cacheControl.expire === undefined
    ) {
      return { expire: config.expireTime, revalidate: cacheControl.revalidate };
    }
    return cacheControl;
  };
  const regex = (path: string, data = false) =>
    normalizeRouteRegex(
      getNamedRouteRegex(
        path,
        data
          ? {
              excludeOptionalTrailingSlash: true,
              includeSuffix: true,
              prefixRouteKeys: false,
            }
          : { prefixRouteKeys: false }
      ).re.source
    );
  for (const [page, paths] of pages) {
    let hasRevalidateZero = getCacheControl(page).revalidate === 0;
    const prerenderedRoutes: any[] = paths.prerenderedRoutes ?? [];
    const sorted = [
      ...sortPageObjects(
        prerenderedRoutes.filter((route) => !route.fallbackRouteParams?.length),
        (route: any) => route.pathname
      ),
      ...sortPageObjects(
        prerenderedRoutes.filter((route) => route.fallbackRouteParams?.length),
        (route: any) => route.pathname
      ),
    ];
    for (const route of sorted) {
      if (route.fallbackRouteParams?.length) {
        continue;
      }
      if (isDynamicRoute(page) && route.pathname === page) {
        continue;
      }
      const result = exported?.byPath.get(route.pathname);
      if (!result) {
        continue;
      }
      const cacheControl = getCacheControl(route.pathname, undefined);
      if (cacheControl.revalidate === 0) {
        hasRevalidateZero = true;
        continue;
      }
      const dataRoute = posix.join(`${normalizePagePath(route.pathname)}.rsc`);
      const meta = collectMeta(result.metadata ?? {});
      routesOut[route.pathname] = {
        dataRoute,
        experimentalPPR: true,
        initialExpireSeconds: cacheControl.expire,
        initialHeaders: meta.headers,
        initialRevalidateSeconds: cacheControl.revalidate,
        initialStatus: route.pathname === "/_not-found" ? 404 : meta.status,
        prefetchDataRoute: result.hasStaticRsc ? dataRoute : undefined,
        renderingMode: "PARTIALLY_STATIC",
        srcRoute: page,
      };
    }
    if (hasRevalidateZero || !isDynamicRoute(page)) {
      continue;
    }
    const { paramMatching } = paths;
    const notFoundParams = paramMatching
      ? Object.keys(paramMatching).filter(
          (name) => paramMatching[name] === "not-found"
        )
      : undefined;
    const candidates = new Map<string, any[]>();
    for (const candidate of sorted) {
      candidates.set(candidate.pathname, [
        ...(candidates.get(candidate.pathname) ?? []),
        candidate,
      ]);
    }
    for (const route of sortPageObjects(
      paths.prerenderRouteMatchers ?? [],
      (matcher: any) => matcher.pathname
    ) as any[]) {
      for (const candidate of candidates.get(route.pathname) ?? [undefined]) {
        if (isStaticMetadataFile(route.pathname)) {
          continue;
        }
        const output: string = candidate?.pathname ?? route.pathname;
        const result = exported?.byPath.get(output);
        if (candidate && !result) {
          continue;
        }
        const cacheControl = getCacheControl(output);
        const dataRoute = posix.join(`${normalizePagePath(output)}.rsc`);
        const fallbackMode =
          candidate &&
          result?.hasEmptyStaticShell &&
          (route.isFallbackModeInferred ||
            !candidate.throwOnEmptyStaticShell) &&
          route.fallbackMode === FallbackMode.PRERENDER
            ? FallbackMode.BLOCKING_STATIC_RENDER
            : (route.fallbackMode ?? FallbackMode.NOT_FOUND);
        const prerender = fallbackMode === FallbackMode.PRERENDER;
        const meta =
          result?.metadata && prerender ? collectMeta(result.metadata) : {};
        // build/index.ts と同じ順
        // oxlint-disable-next-line sort-keys -- 同上
        dynamicRoutes[output] = {
          notFoundParams,
          experimentalPPR: true,
          remainingPrerenderableParams: route.remainingPrerenderableParams,
          throwOnEmptyStaticShell: candidate
            ? candidate.throwOnEmptyStaticShell
            : false,
          renderingMode: "PARTIALLY_STATIC",
          routeRegex: regex(output),
          dataRoute,
          fallback: fallbackModeToFallbackField(fallbackMode, route.pathname),
          isExplicitlyBlocking:
            fallbackMode === FallbackMode.BLOCKING_STATIC_RENDER &&
            route.fallbackRouteParams.some(
              ({ paramName }: any) => paramMatching?.[paramName] === "blocking"
            )
              ? true
              : undefined,
          fallbackRevalidate: prerender ? cacheControl.revalidate : undefined,
          fallbackExpire: prerender ? cacheControl.expire : undefined,
          fallbackStatus: meta.status,
          fallbackHeaders: meta.headers,
          fallbackRootParams: route.fallbackRouteParams
            ? route.fallbackRootParams
            : undefined,
          fallbackSourceRoute: route.fallbackRouteParams?.length
            ? page
            : undefined,
          fallbackRouteParams: route.fallbackRouteParams,
          dataRouteRegex: regex(dataRoute, true),
          prefetchDataRoute: null,
          prefetchDataRouteRegex: undefined,
        };
      }
    }
  }
  return {
    dynamicRoutes,
    notFoundRoutes: [...(exported?.ssgNotFoundPaths ?? [])],
    routes: routesOut,
  };
};
// next build と同じく、Next.js の exportApp（静的なページの prerender。build/index.ts の static-generation）を
// このプロセスで動かし（StaticWorker の代わりに export/worker を直接呼ぶ）、その結果から build/index.ts と同じく
// - prefetch hints: metadata.prefetchHints をページごとに最初のものだけ残す
// - prerender-manifest の routes / dynamicRoutes（cacheComponents のアプリだけ。next start が読む項目。下の prerenderManifestRoutes）
// exportPathMap は build/index.ts と同じく、各ページの generateStaticParams（loadStaticPaths）の URL
const collectBuildOutput = async (): Promise<BuildOutput> => {
  const exportApp = require("next/dist/export").default;
  const { exportPages } = require("next/dist/export/worker");
  const map: Record<string, unknown> = {};
  // prerender する URL → ルートのパス（hints のキー）
  const routeOf = new Map<string, string>();
  const pages = [...routes].filter(([, { page }]) => page.endsWith("/page"));
  // 動的でないページは、そのパスだけ（build/index.ts と同じ。revalidate が 0 のページも入れるが、prerender で動的になり hints は出ない）
  const results = await Promise.all(
    pages.map(([path]) =>
      isDynamicRoute(path)
        ? staticPathsResult(path)
        : {
            prerenderedRoutes: [
              {
                encodedPathname: path,
                fallbackRootParams: [],
                fallbackRouteParams: [],
                pathname: path,
                throwOnEmptyStaticShell: true,
              },
            ],
          }
    )
  );
  for (const [i, [path, { page }]] of pages.entries()) {
    for (const route of (results[i].prerenderedRoutes ?? []) as any[]) {
      // build/index.ts と同じく、cacheComponents でなければ動的なルートのセグメントが残る URL は prerender しない
      if (route.fallbackRootParams?.length && !config.cacheComponents) {
        continue;
      }
      map[route.pathname] = {
        _allowEmptyStaticShell: !route.throwOnEmptyStaticShell,
        _fallbackRouteParams: route.fallbackRouteParams,
        _isAppDir: true,
        _isFallbackUpgradeable:
          Boolean(config.partialPrefetching) &&
          (route.remainingPrerenderableParams?.length ?? 0) > 0,
        _isRoutePPREnabled: !!config.cacheComponents,
        _ssgPath: route.encodedPathname,
        page,
      };
      routeOf.set(route.pathname, path);
    }
  }
  // prerender できないページ（next build なら失敗する）は、結果に入れずに続ける
  const worker = {
    exportPages: async (input: unknown) =>
      ((await exportPages(input)) as any[]).map((item) =>
        "error" in (item.result ?? {}) ? { ...item, result: undefined } : item
      ),
    setOnActivity() {
      // 進み具合は使わない
    },
    setOnActivityAbort() {
      // 進み具合は使わない
    },
  };
  const exported = await exportApp(
    projectDir,
    {
      appDirOnly: true,
      buildExport: true,
      enabledDirectories: { app: true, pages: false },
      nextConfig: {
        ...config,
        distDir: relative(projectDir, distDir),
        experimental: { ...config.experimental, prerenderEarlyExit: false },
        exportPathMap: () => map,
      },
      numWorkers: 1,
      outdir: join(distDir, "export"),
      pages: [],
      silent: true,
    },
    require("next/dist/trace").trace("proofyard-export"),
    worker
  );
  const prefetchHints: Record<string, unknown> = {};
  for (const [path, page] of routeOf) {
    const hints = exported?.byPath.get(path)?.metadata?.prefetchHints;
    if (hints && !(page in prefetchHints)) {
      prefetchHints[page] = hints;
    }
  }
  const manifest = config.cacheComponents
    ? prerenderManifestRoutes(
        exported,
        pages.map(([path], i) => [path, results[i]])
      )
    : { dynamicRoutes: {}, notFoundRoutes: [], routes: {} };
  const emptyStaticShells = [...routeOf.keys()].filter(
    (path) => exported?.byPath.get(path)?.hasEmptyStaticShell
  );
  return { emptyStaticShells, prefetchHints, ...manifest };
};
interface BuildOutput {
  prefetchHints: Record<string, unknown>;
  // next build が空の静的シェル（.html）を書き出した URL（generateStaticParams があり、params を Suspense の外で待つフォールバックのシェルなど）
  emptyStaticShells: string[];
  routes: Record<string, unknown>;
  dynamicRoutes: Record<string, unknown>;
  notFoundRoutes: string[];
}
// next build の prerender のプロセス（buildOutput）は、prerender して書き出したら終わる
if (BUILD_OUTPUT) {
  // 書き終えてから名前を付ける（他のワーカーが書きかけを読まないように）
  const exported = await collectBuildOutput();
  console.log(`[proofyard] exportApp: ${(performance.now() - t).toFixed(0)}ms`);
  write(`${BUILD_OUTPUT}.${process.pid}`, exported);
  renameSync(`${BUILD_OUTPUT}.${process.pid}`, BUILD_OUTPUT);
  process.exit(0);
}
// テストが始まる前にビルドを終える（最初の render() のテストがビルドの時間でタイムアウトしないように）
const ssrImported = performance.now() - t;
const [, routeTook] = await Promise.all([
  buildBrowser(),
  routeBuild!.then(() => performance.now() - routeStarted),
]);
const ms = (n: number) => `${n.toFixed(0)}ms`;
// browser build は SSR 層のビルドと同時に始めるので、ここで待った時間より長い
console.log(
  `[proofyard] browser layer: ${ms(performance.now() - t)}${debug ? ` (ssr modules ${ms(ssrImported)}, browser build ${ms(browserTook)}, route build ${ms(routeTook)}; browser build from before the ssr build)` : ""}`
);

const { prefetchHints, emptyStaticShells, ...prerendered } =
  (await buildOutput)!;
write(join(distDir, `server/${PREFETCH_HINTS}`), prefetchHints);
Object.assign(prerenderManifest, prerendered);
write(join(distDir, "prerender-manifest.json"), prerenderManifest);
console.log(
  `[proofyard] next build (prerender): ${Object.keys(prefetchHints).length} pages ${(performance.now() - t).toFixed(0)}ms`
);
const prerenderRoute = async (url: string): Promise<PrerenderRouteResult> => {
  if (!config.cacheComponents) {
    throw new Error(
      "[proofyard] Unsupported: prerenderRoute requires cacheComponents (Partial Prerendering)"
    );
  }
  const target = new URL(url, "http://localhost");
  // 動的なルートは、ルートのパス（/products/[id]）ならフォールバックのシェル（パラメーターを使うところは Suspense の fallback のまま）。
  // Next.js の静的シェルのデバッグの fallback を使う（next build の [id].html と同じ）。
  // 具体的な URL は、next start と同じく Next.js が prerender-manifest から選ぶ（generateStaticParams が返さなければフォールバックのシェルか、
  // フォールバックのシェルが空でもよいルートならその URL の prerender）
  const fallback =
    routes.has(target.pathname) && isDynamicRoute(target.pathname);
  // next build が空のシェルを書き出したフォールバック（generateStaticParams があり、params を Suspense の外で待つ）。
  // next start はそれをキャッシュから返すが、ここで描画すると（キャッシュがないので）空のシェルを許さずに失敗する。
  // next start と同じく、空のシェルに Next.js のデバッグ用の閉じタグだけを足して返す
  if (fallback && emptyStaticShells.includes(target.pathname)) {
    return {
      dynamicBoundaries: [],
      postponed: true,
      shell: new TextDecoder().decode(ENCODED_TAGS.CLOSED.BODY_AND_HTML),
      status: 200,
    };
  }
  target.searchParams.set("__nextppronly", fallback ? "fallback" : "1");
  // prerender の失敗（Suspense の外の動的なデータなど）は、Next.js がログに出す（next build と同じ文面）
  const logged: string[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(format(...args));
    consoleError(...args);
  };
  try {
    const response = await requestRoute(target.pathname + target.search);
    const shell = await response.text();
    if (response.status >= 500) {
      throw new Error(
        `[proofyard] prerendering ${url} failed (status ${response.status})\n${logged.join("\n")}`
      );
    }
    return {
      dynamicBoundaries: [
        ...shell.matchAll(/<!--\$\?--><template id="(?<id>[^"]+)"/gu),
      ].map((m) => m[1]!),
      postponed: response.headers.get("x-nextjs-postponed") === "1",
      shell,
      status: response.status,
    };
  } finally {
    console.error = consoleError;
  }
};
(globalThis as any)[Symbol.for("proofyard.next")] = {
  actionCalls: () => [...routeActionCalls],
  assetPrefix: config.assetPrefix,
  flushAfter,
  invalidatedTags,
  loadBrowser,
  prefetchHints,
  prerenderManifest,
  prerenderRoute,
  requestRoute,
  routeBundle: () => routeBuild!,
  ssrModuleMap,
  ssrRuntime,
} satisfies NextHarness;
export interface NextHarness {
  requestRoute: typeof requestRoute;
  prerenderRoute: typeof prerenderRoute;
  invalidatedTags: typeof invalidatedTags;
  // このテストで Next.js の handler が呼んだ Server Action
  actionCalls: () => ActionCall[];
  flushAfter: typeof flushAfter;
  loadBrowser: typeof loadBrowser;
  ssrRuntime: typeof ssrRuntime;
  ssrModuleMap: typeof ssrModuleMap;
  // renderRoute の Client Mode のバンドル（ファイルのパス）
  routeBundle: () => Promise<string>;
  // next build の prefetch-hints.json と同じもの（tests/compatibility で比べる）
  prefetchHints: Record<string, unknown>;
  // next build の prerender-manifest.json と同じもの（next start が読む項目だけ）
  prerenderManifest: typeof prerenderManifest;
  // Next.js のチャンクの URL の前に付くもの（next.config の assetPrefix。空なら basePath。server/config.ts）
  assetPrefix: string;
}
