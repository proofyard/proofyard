// Next.js のビルドの層を Bun.build で再現する。
//   rsc: react-server 層（nodejs）。"use client" は Client Reference に置き換える
//   ssr: SSR 層（nodejs）。Client Component の実装を SSR 用の React で読む
//   browser: ブラウザ層。Client Component の実装をブラウザ用の React（next/dist/compiled/react）で読む（Client Mode）
// 共通:
// - react 系は Next.js の runtime バンドル内の React（vendored/rsc, vendored/ssr）へ（create-compiler-aliases.ts）
// - *.shared-runtime は app-page 用の vendored/contexts へ（webpack-config.ts の NormalModuleReplacementPlugin。サーバーの層だけ）
// - *.external.js と runtime バンドルは層をまたいで共有するので外部のまま（handle-externals.ts）
import nodePath from "node:path";

import { STYLE_FILE } from "./css";

const { join, dirname, resolve: resolvePath } = nodePath;

const VENDORED = "next/dist/server/route-modules/app-page/vendored";
const reactAliases = (layer: "rsc" | "ssr") => ({
  react: `${VENDORED}/${layer}/react`,
  "react-dom": `${VENDORED}/${layer}/react-dom`,
  "react/compiler-runtime": `${VENDORED}/${layer}/react-compiler-runtime`,
  "react/jsx-dev-runtime": `${VENDORED}/${layer}/react-jsx-dev-runtime`,
  "react/jsx-runtime": `${VENDORED}/${layer}/react-jsx-runtime`,
});
export const ALIASES = {
  browser: {},
  rsc: {
    ...reactAliases("rsc"),
    "@opentelemetry/api": "next/dist/compiled/@opentelemetry/api",
    "client-only": "next/dist/compiled/client-only/error",
    "react-server-dom-webpack/server": `${VENDORED}/rsc/react-server-dom-webpack-server`,
    "react-server-dom-webpack/server.node": `${VENDORED}/rsc/react-server-dom-webpack-server`,
    "react-server-dom-webpack/static": `${VENDORED}/rsc/react-server-dom-webpack-static`,
    "server-only": "next/dist/compiled/server-only/empty",
  },
  ssr: {
    ...reactAliases("ssr"),
    "@opentelemetry/api": "next/dist/compiled/@opentelemetry/api",
    "client-only": "next/dist/compiled/client-only/index",
    // 同梱の react-dom（server.node など）は next/dist/compiled/react を直接読むので、それも SSR 用の React に
    "next/dist/compiled/react": `${VENDORED}/ssr/react`,
    "next/dist/compiled/react-dom": `${VENDORED}/ssr/react-dom`,
    "react-server-dom-webpack/client": `${VENDORED}/ssr/react-server-dom-webpack-client`,
    "server-only": "next/dist/compiled/server-only/error",
  },
} as const;
// 層のバンドルに含めるエイリアス（create-compiler-aliases.ts）
// - next/navigation などは層ごとに別実装（createAppRouterApiAliases）
// - private-next-rsc-*: SWC が "use cache" / "use server" の変換で出力する import
// - 実行時に NODE_ENV で開発版と本番版を選ぶもの（react-server-dom-webpack/client など）。
//   外部にすると bun test の NODE_ENV=test で開発版になり、本番版の React と混ざる
export const BUNDLED_ALIASES = {
  // createVendoredReactAliases の browser / client と createAppRouterApiAliases
  browser: {
    "client-only": "next/dist/compiled/client-only/index",
    "next/dist/client/app-call-server": join(
      import.meta.dir,
      "../client/app-call-server.ts"
    ),
    "next/dynamic": "next/dist/api/app-dynamic",
    "next/form": "next/dist/client/app-dir/form",
    "next/head": "next/dist/client/components/noop-head",
    "next/link": "next/dist/client/app-dir/link",
    // SWC が Client Component から import した "use server" を変換したもの
    "private-next-rsc-action-client-wrapper":
      "next/dist/build/webpack/loaders/next-flight-loader/action-client-wrapper",
    react: "next/dist/compiled/react",
    "react-dom": "next/dist/compiled/react-dom",
    "react-dom/client": "next/dist/compiled/react-dom/client",
    "react-dom/server": "next/dist/compiled/react-dom/server.browser",
    "react-dom/test-utils": join(
      import.meta.dir,
      "../client/react-dom-test-utils.ts"
    ),
    // Flight クライアントは、Flight を作るサーバー（本番版）と揃えて本番版にする（React 本体は act のために開発版。src/next/preload.ts）。
    // 開発版のクライアントは開発版のサーバーだけが送る情報（key の検証済みの印、エラーのスタック）を前提にしていて、本番版のサーバーとは組み合わせられない
    "react-server-dom-webpack/client":
      "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js",
    "react/compiler-runtime": "next/dist/compiled/react/compiler-runtime",
    "react/jsx-dev-runtime": "next/dist/compiled/react/jsx-dev-runtime",
    "react/jsx-runtime": "next/dist/compiled/react/jsx-runtime",
    scheduler: "next/dist/compiled/scheduler",
    "server-only": "next/dist/compiled/server-only/error",
  },
  rsc: {
    "next/dynamic": "next/dist/api/app-dynamic",
    "next/error": "next/dist/api/error.react-server",
    "next/form": "next/dist/client/app-dir/form",
    "next/head": "next/dist/client/components/noop-head",
    "next/link": "next/dist/client/app-dir/link.react-server",
    "next/navigation": "next/dist/api/navigation.react-server",
    "private-next-rsc-action-client-wrapper":
      "next/dist/build/webpack/loaders/next-flight-loader/action-client-wrapper",
    "private-next-rsc-action-encryption":
      "next/dist/server/app-render/encryption",
    "private-next-rsc-action-validate":
      "next/dist/build/webpack/loaders/next-flight-loader/action-validate",
    "private-next-rsc-cache-wrapper":
      "next/dist/build/webpack/loaders/next-flight-loader/cache-wrapper",
    "private-next-rsc-server-reference":
      "next/dist/build/webpack/loaders/next-flight-loader/server-reference",
    "private-next-rsc-track-dynamic-import":
      "next/dist/build/webpack/loaders/next-flight-loader/track-dynamic-import",
    "react-server-dom-webpack/client":
      "next/dist/compiled/react-server-dom-webpack/client.node",
  },
  ssr: {
    "next/dynamic": "next/dist/api/app-dynamic",
    "next/form": "next/dist/client/app-dir/form",
    "next/head": "next/dist/client/components/noop-head",
    "next/link": "next/dist/client/app-dir/link",
    "react-dom/server": "next/dist/compiled/react-dom/server.node",
    "react-dom/static": "next/dist/compiled/react-dom/static.node",
  },
} as const;

const root = process.cwd();
const abs = (spec: string) => Bun.resolveSync(spec, root);
// SWC の変換が出力する @swc/helpers は Next.js 自身の依存（create-compiler-aliases.ts の '@swc/helpers/_'。アプリが入れていなくてよい）
const swcHelpers = () =>
  dirname(
    Bun.resolveSync(
      "@swc/helpers/package.json",
      dirname(abs("next/package.json"))
    )
  );
// node_modules 内の "use server" / "use cache"（Next.js と同じくアプリと同じ SWC で変換する。rsc 層はネイティブで読み込むときに変換する）
export const SERVER_DIRECTIVE =
  /^\s*["']use (?:server|cache(?::\s*[\w-]+)?)["']/mu;
export const USE_CLIENT =
  /^\s*(?:(?:\/\/[^\n]*\n|\/\*(?:[^*]|\*(?!\/))*\*\/)\s*)*(?:["']use strict["'];?\s*)?["']use client["']/u;

// Client Reference の id（"use client" ファイルの絶対パス）。esmClientIds は ESM（名前空間で渡す）もの
export const clientIds = new Set<string>();
export const esmClientIds = new Set<string>();
// Client Reference の id → export 名
export const clientExports = new Map<string, string[]>();

// ponytail: CommonJS の export 名を正規表現で拾う（exports.X = / Object.defineProperty(exports, "X") / _export(exports, { X: ... })）
export const cjsExportNames = (source: string): string[] => {
  const names = new Set<string>();
  for (const m of source.matchAll(
    /(?:exports\.(?<assigned>[A-Za-z_$][\w$]*)\s*=|defineProperty\(exports,\s*["'](?<defined>[A-Za-z_$][\w$]*)["'])/gu
  )) {
    names.add((m[1] ?? m[2]) as string);
  }
  const exportBlock = source.match(
    /_export\(exports,\s*\{(?<body>[\s\S]*?)\}\);/u
  );
  if (exportBlock) {
    for (const m of (exportBlock[1] as string).matchAll(
      /^\s*(?<name>[A-Za-z_$][\w$]*)\s*:/gmu
    )) {
      names.add(m[1] as string);
    }
  }
  names.delete("__esModule");
  return [...names];
};

const registerStub = (id: string, n: string) =>
  `registerClientReference(function () { throw new Error("[proofyard] client function called on the server"); }, ${id}, ${JSON.stringify(n)})`;

export const clientReferenceStub = (path: string, source: string) => {
  clientIds.add(path);
  const id = JSON.stringify(path);
  const loader = path.match(/\.(?<ext>[jt]sx?)$/u)?.[1] as
    | "js"
    | "jsx"
    | "ts"
    | "tsx"
    | undefined;
  const esmExports = new Bun.Transpiler({ loader: loader ?? "js" }).scan(
    source
  ).exports;
  if (esmExports.length) {
    esmClientIds.add(path);
    clientExports.set(path, esmExports);
    const lines = esmExports.map((n) =>
      n === "default"
        ? `export default ${registerStub(id, n)};`
        : `export const ${n} = ${registerStub(id, n)};`
    );
    return `import { registerClientReference } from "react-server-dom-webpack/server";\n${lines.join("\n")}\n`;
  }
  const names = cjsExportNames(source);
  clientExports.set(path, names);
  // CommonJS は Next.js の next-flight-loader と同じく React の createClientModuleProxy。
  // ESM で返す（実行時のプラグインでは module.exports が失われる）。default の import は webpack と同じく __esModule を見る
  const lines = names
    .filter((n) => n !== "default")
    .map((n) => `export const ${n} = proxy[${JSON.stringify(n)}];`);
  return `import { createClientModuleProxy } from "react-server-dom-webpack/server";\nconst proxy = createClientModuleProxy(${id});\nexport default proxy.__esModule ? proxy.default : proxy;\n${lines.join("\n")}\n`;
};

export interface LayerOptions {
  // 出力先（--parallel のワーカーどうしで共有するときは、実行ごとのディレクトリ）
  outdir: string;
  // Next.js の getDefineEnv の結果（環境で決まる分岐を next build と同じく畳む）
  define: Record<string, string>;
  // next-app-loader が生成したエントリの置き場所。そこからの import はプロジェクトルートから解決する
  generatedDir?: string;
  // アプリのソースの変換（Next.js の SWC）。対象外のファイルは undefined を返す
  transform?: (path: string, source: string) => Promise<string | undefined>;
  // このディレクトリのファイル（node_modules を除く）はバンドルせず外部のまま（実行時にネイティブで読み込む。mock.module が効く）
  nativeDir?: string;
  // 解決したファイルの差し替え（ブラウザ層の .browser の兄弟など。create-compiler-aliases.ts の client 用のもの）
  redirect?: (resolved: string) => string | undefined;
  // 層のエイリアスの上書き（BUNDLED_ALIASES に足す。値が undefined なら外す）
  aliases?: Record<string, string | undefined>;
  // CSS の import（src/next/css.ts）
  style?: (path: string) => Promise<{ loader: "js"; contents: string }>;
  // false なら 1 つのファイルにまとめる（クエリ付きの import で評価し直すと、モジュールの状態ごと新しくなる）
  splitting?: boolean;
  // ビルドが読んだファイルを足す（実行をまたいだキャッシュの入力。src/next/layer-cache.ts）
  inputs?: Set<string>;
}

export type Layer = "rsc" | "ssr" | "browser";

export const buildLayer = async (
  layer: Layer,
  entries: string[],
  {
    outdir,
    define,
    generatedDir,
    transform,
    nativeDir,
    redirect,
    aliases: override,
    style,
    splitting = true,
    inputs,
  }: LayerOptions
) => {
  const aliases: Record<string, string> = ALIASES[layer];
  const bundledAliases = Object.fromEntries(
    Object.entries({ ...BUNDLED_ALIASES[layer], ...override }).filter(
      (e): e is [string, string] => e[1] !== undefined
    )
  );
  const entryPaths = entries.map((e) => (e.startsWith("/") ? e : abs(e)));
  // PROOFYARD_DEBUG: プラグインが JS で使った時間（onResolve と、onLoad の読み込み後の処理）と呼ばれた回数
  const spent = { load: 0, loads: 0, resolve: 0, resolves: 0 };
  // 読み込んだ後の処理の時間を足す
  const afterRead = async <T>(
    path: string,
    f: (source: string) => T | Promise<T>
  ): Promise<T> => {
    const source = await Bun.file(path).text();
    const start = performance.now();
    try {
      return await f(source);
    } finally {
      spent.load += performance.now() - start;
      spent.loads += 1;
    }
  };
  let conditions: string[] = [];
  if (layer === "rsc") {
    conditions = ["react-server"];
  } else if (layer === "browser") {
    conditions = ["browser"];
  }
  const started = performance.now();
  const result = await Bun.build({
    conditions,
    define,
    entrypoints: entryPaths,
    format: "esm",
    // define の NODE_ENV と揃える（prod の React に jsxDEV はない）
    jsx: { development: define["process.env.NODE_ENV"] === '"development"' },
    metafile: !!inputs,
    naming: "[dir]/[name]-[hash].[ext]",
    outdir,
    plugins: [
      {
        name: `next-${layer}-layer`,
        setup(build) {
          const resolve = (args: { path: string; importer: string }) => {
            if (args.path in aliases) {
              return {
                external: true,
                path: abs(aliases[args.path] as string),
              };
            }
            const shared =
              layer !== "browser" &&
              args.path.match(/\.\/(?:.+\/)?(?<name>[^/]+)\.shared-runtime$/u);
            if (shared) {
              return {
                external: true,
                path: abs(`${VENDORED}/contexts/${shared[1]}`),
              };
            }
            if (args.path in bundledAliases) {
              return { path: abs(bundledAliases[args.path] as string) };
            }
            if (args.path.startsWith("@swc/helpers/_/")) {
              return {
                path: Bun.resolveSync(`.${args.path.slice(12)}`, swcHelpers()),
              };
            }
            if (args.path.startsWith("node:") || !args.importer) {
              return;
            }
            const generated =
              generatedDir !== undefined &&
              args.importer.startsWith(generatedDir);
            let resolved: string;
            try {
              resolved = Bun.resolveSync(
                args.path,
                generated ? root : dirname(args.importer)
              );
            } catch {
              // 解決できない任意依存（開発専用など）は外部にし、実行時に到達したときだけ失敗させる
              return { external: true, path: args.path };
            }
            if (
              /\.external(?:\.js)?$/u.test(resolved) ||
              /module\.compiled(?:\.js)?$/u.test(resolved)
            ) {
              return { external: true, path: resolved };
            }
            if (
              nativeDir !== undefined &&
              resolved.startsWith(`${nativeDir}/`) &&
              !resolved.includes("/node_modules/")
            ) {
              return { external: true, path: resolved };
            }
            const redirected = redirect?.(resolved);
            if (redirected) {
              return { path: redirected };
            }
            if (generated) {
              return { path: resolved };
            }
          };
          // oxlint-disable-next-line require-unicode-regexp -- Bun のプラグインの filter（ネイティブの照合）
          build.onResolve({ filter: /.*/ }, (args) => {
            const start = performance.now();
            try {
              return resolve(args);
            } finally {
              spent.resolve += performance.now() - start;
              spent.resolves += 1;
            }
          });
          if (style) {
            build.onLoad({ filter: STYLE_FILE }, (args) => style(args.path));
          }
          if (layer === "rsc") {
            // node_modules の JS とアプリのソース（"use client" は Client Reference に、それ以外のアプリのソースは SWC に）
            build.onLoad(
              // oxlint-disable-next-line require-unicode-regexp -- Bun のプラグインの filter（ネイティブの照合）
              { filter: /\.(?:[cm]?js|jsx|tsx?)$/ },
              // oxlint-disable-next-line require-await -- onLoad に Promise を返す（同期の戻り値にしない）
              async (args) => {
                const inNodeModules = args.path.includes("/node_modules/");
                if (inNodeModules && !/\.[cm]?js$/u.test(args.path)) {
                  return;
                }
                return afterRead(args.path, async (source) => {
                  if (USE_CLIENT.test(source)) {
                    return {
                      contents: clientReferenceStub(args.path, source),
                      loader: "js",
                    };
                  }
                  if (inNodeModules) {
                    // rsc 層のバンドルは Next.js 本体だけ。変換はネイティブで読み込むとき（preload.ts）なので、バンドルに入れば変換されない
                    if (SERVER_DIRECTIVE.test(source)) {
                      throw new Error(
                        `Unsupported Next.js feature: "use server" / "use cache" in node_modules is not compiled by the current runtime (${args.path})`
                      );
                    }
                    return;
                  }
                  const code = await transform?.(args.path, source);
                  if (code !== undefined) {
                    return { contents: code, loader: "js" };
                  }
                });
              }
            );
          } else if (transform) {
            // oxlint-disable-next-line require-unicode-regexp -- Bun のプラグインの filter（ネイティブの照合）
            build.onLoad({ filter: /\.(?:[cm]?js|jsx|tsx?)$/ }, (args) =>
              afterRead(args.path, async (source) => {
                // node_modules は "use server" / "use cache" のあるものだけ変換する
                if (
                  args.path.includes("/node_modules/") &&
                  !SERVER_DIRECTIVE.test(source)
                ) {
                  return;
                }
                const code = await transform(args.path, source);
                if (code !== undefined) {
                  return { contents: code, loader: "js" as const };
                }
              })
            );
          }
        },
      },
    ],
    root: "/",
    splitting,
    target: layer === "browser" ? "browser" : "bun",
  });
  if (process.env.PROOFYARD_DEBUG) {
    console.log(
      `[proofyard] (${layer} build, ${entries.length} entries) ${(performance.now() - started).toFixed(0)}ms; plugin JS: onResolve ${spent.resolves}x ${spent.resolve.toFixed(0)}ms, onLoad ${spent.loads}x ${spent.load.toFixed(0)}ms`
    );
  }
  if (!result.success) {
    throw new AggregateError(result.logs, `${layer} layer build failed`);
  }
  // metafile のパスは実行したディレクトリからの相対パス
  for (const path of Object.keys(result.metafile?.inputs ?? {})) {
    inputs?.add(resolvePath(path));
  }
  // 入口ごとの出力（[dir] を保つので入口の絶対パスから引ける）
  const out = new Map<string, string>();
  for (const entry of entryPaths) {
    const stem = entry.replace(/\.[cm]?[jt]sx?$/u, "");
    const o = result.outputs.find(
      (x) =>
        x.kind === "entry-point" && x.path.startsWith(`${join(outdir, stem)}-`)
    );
    if (!o) {
      throw new Error(`no output for ${entry}`);
    }
    out.set(entry, o.path);
  }
  return out;
};
