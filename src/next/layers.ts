// Next.js のビルドの層を Bun.build で再現する。
//   rsc: react-server 層（nodejs）。"use client" は Client Reference に置き換える
//   ssr: SSR 層（nodejs）。Client Component の実装を SSR 用の React で読む
//   browser: ブラウザ層。Client Component の実装をブラウザ用の React（next/dist/compiled/react）で読む（Client Mode）
// 共通:
// - react 系は Next.js の runtime バンドル内の React（vendored/rsc, vendored/ssr）へ（create-compiler-aliases.ts）
// - *.shared-runtime は app-page 用の vendored/contexts へ（webpack-config.ts の NormalModuleReplacementPlugin。サーバーの層だけ）
// - *.external.js と runtime バンドルは層をまたいで共有するので外部のまま（handle-externals.ts）
import { readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";

const VENDORED = "next/dist/server/route-modules/app-page/vendored";
const reactAliases = (layer: "rsc" | "ssr") => ({
  react: `${VENDORED}/${layer}/react`,
  "react/compiler-runtime": `${VENDORED}/${layer}/react-compiler-runtime`,
  "react/jsx-runtime": `${VENDORED}/${layer}/react-jsx-runtime`,
  "react/jsx-dev-runtime": `${VENDORED}/${layer}/react-jsx-dev-runtime`,
  "react-dom": `${VENDORED}/${layer}/react-dom`,
});
export const ALIASES = {
  rsc: {
    ...reactAliases("rsc"),
    "react-server-dom-webpack/server": `${VENDORED}/rsc/react-server-dom-webpack-server`,
    "react-server-dom-webpack/server.node": `${VENDORED}/rsc/react-server-dom-webpack-server`,
    "react-server-dom-webpack/static": `${VENDORED}/rsc/react-server-dom-webpack-static`,
    "server-only": "next/dist/compiled/server-only/empty",
    "client-only": "next/dist/compiled/client-only/error",
    "@opentelemetry/api": "next/dist/compiled/@opentelemetry/api",
  },
  ssr: {
    ...reactAliases("ssr"),
    // 同梱の react-dom（server.node など）は next/dist/compiled/react を直接読むので、それも SSR 用の React に
    "next/dist/compiled/react": `${VENDORED}/ssr/react`,
    "next/dist/compiled/react-dom": `${VENDORED}/ssr/react-dom`,
    "react-server-dom-webpack/client": `${VENDORED}/ssr/react-server-dom-webpack-client`,
    "server-only": "next/dist/compiled/server-only/error",
    "client-only": "next/dist/compiled/client-only/index",
    "@opentelemetry/api": "next/dist/compiled/@opentelemetry/api",
  },
  browser: {},
} as const;
// 層のバンドルに含めるエイリアス（create-compiler-aliases.ts）
// - next/navigation などは層ごとに別実装（createAppRouterApiAliases）
// - private-next-rsc-*: SWC が "use cache" / "use server" の変換で出力する import
// - 実行時に NODE_ENV で開発版と本番版を選ぶもの（react-server-dom-webpack/client など）。
//   外部にすると bun test の NODE_ENV=test で開発版になり、本番版の React と混ざる
export const BUNDLED_ALIASES = {
  rsc: {
    "react-server-dom-webpack/client": "next/dist/compiled/react-server-dom-webpack/client.node",
    "private-next-rsc-action-validate": "next/dist/build/webpack/loaders/next-flight-loader/action-validate",
    "private-next-rsc-action-client-wrapper": "next/dist/build/webpack/loaders/next-flight-loader/action-client-wrapper",
    "private-next-rsc-server-reference": "next/dist/build/webpack/loaders/next-flight-loader/server-reference",
    "private-next-rsc-action-encryption": "next/dist/server/app-render/encryption",
    "private-next-rsc-cache-wrapper": "next/dist/build/webpack/loaders/next-flight-loader/cache-wrapper",
    "private-next-rsc-track-dynamic-import": "next/dist/build/webpack/loaders/next-flight-loader/track-dynamic-import",
    "next/navigation": "next/dist/api/navigation.react-server",
    "next/error": "next/dist/api/error.react-server",
    "next/link": "next/dist/client/app-dir/link.react-server",
    "next/head": "next/dist/client/components/noop-head",
    "next/dynamic": "next/dist/api/app-dynamic",
    "next/form": "next/dist/client/app-dir/form",
  },
  ssr: {
    "react-dom/server": "next/dist/compiled/react-dom/server.node",
    "react-dom/static": "next/dist/compiled/react-dom/static.node",
    "next/link": "next/dist/client/app-dir/link",
    "next/head": "next/dist/client/components/noop-head",
    "next/dynamic": "next/dist/api/app-dynamic",
    "next/form": "next/dist/client/app-dir/form",
  },
  // createVendoredReactAliases の browser / client と createAppRouterApiAliases
  browser: {
    react: "next/dist/compiled/react",
    "react/compiler-runtime": "next/dist/compiled/react/compiler-runtime",
    "react/jsx-runtime": "next/dist/compiled/react/jsx-runtime",
    "react/jsx-dev-runtime": "next/dist/compiled/react/jsx-dev-runtime",
    "react-dom": "next/dist/compiled/react-dom",
    "react-dom/client": "next/dist/compiled/react-dom/client",
    "react-dom/server": "next/dist/compiled/react-dom/server.browser",
    "react-dom/test-utils": join(import.meta.dir, "../client/react-dom-test-utils.ts"),
    // Flight クライアントは、Flight を作るサーバー（本番版）と揃えて本番版にする（React 本体は act のために開発版。src/next/preload.ts）。
    // 開発版のクライアントは開発版のサーバーだけが送る情報（key の検証済みの印、エラーのスタック）を前提にしていて、本番版のサーバーとは組み合わせられない
    "react-server-dom-webpack/client": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js",
    scheduler: "next/dist/compiled/scheduler",
    "server-only": "next/dist/compiled/server-only/error",
    "client-only": "next/dist/compiled/client-only/index",
    "next/link": "next/dist/client/app-dir/link",
    "next/head": "next/dist/client/components/noop-head",
    "next/dynamic": "next/dist/api/app-dynamic",
    "next/form": "next/dist/client/app-dir/form",
    // SWC が Client Component から import した "use server" を変換したもの
    "private-next-rsc-action-client-wrapper": "next/dist/build/webpack/loaders/next-flight-loader/action-client-wrapper",
    "next/dist/client/app-call-server": join(import.meta.dir, "../client/app-call-server.ts"),
  },
} as const;

const root = process.cwd();
const abs = (spec: string) => Bun.resolveSync(spec, root);
// node_modules 内の "use server" / "use cache"（Next.js は SWC で変換する。ここでは変換しないので Fail Closed）
const SERVER_DIRECTIVE = /^\s*["']use (?:server|cache(?::\s*[\w-]+)?)["']/m;
export const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:["']use strict["'];?\s*)?["']use client["']/;

// Client Reference の id（"use client" ファイルの絶対パス）。esmClientIds は ESM（名前空間で渡す）もの
export const clientIds = new Set<string>();
export const esmClientIds = new Set<string>();
// Client Reference の id → export 名
export const clientExports = new Map<string, string[]>();

const registerStub = (id: string, n: string) =>
  `registerClientReference(function () { throw new Error("[proofyard] client function called on the server"); }, ${id}, ${JSON.stringify(n)})`;

export function clientReferenceStub(path: string, source: string) {
  clientIds.add(path);
  const id = JSON.stringify(path);
  const loader = path.match(/\.([jt]sx?)$/)?.[1] as "js" | "jsx" | "ts" | "tsx" | undefined;
  const esmExports = new Bun.Transpiler({ loader: loader ?? "js" }).scan(source).exports;
  if (esmExports.length) {
    esmClientIds.add(path);
    clientExports.set(path, esmExports);
    const lines = esmExports.map((n) => (n === "default" ? `export default ${registerStub(id, n)};` : `export const ${n} = ${registerStub(id, n)};`));
    return `import { registerClientReference } from "react-server-dom-webpack/server";\n${lines.join("\n")}\n`;
  }
  // ponytail: export 名を正規表現で拾う（CJS の exports.X = / Object.defineProperty(exports, "X") / _export(exports, { X: ... })）
  const names = new Set<string>();
  for (const m of source.matchAll(/(?:exports\.([A-Za-z_$][\w$]*)\s*=|defineProperty\(exports,\s*["']([A-Za-z_$][\w$]*)["'])/g)) names.add(m[1] ?? m[2]!);
  const exportBlock = source.match(/_export\(exports,\s*\{([\s\S]*?)\}\);/);
  if (exportBlock) for (const m of exportBlock[1]!.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) names.add(m[1]!);
  names.delete("__esModule");
  clientExports.set(path, [...names]);
  const lines = [...names].map((n) => `${JSON.stringify(n)}: ${registerStub(id, n)}`);
  return `import { registerClientReference } from "react-server-dom-webpack/server";\nmodule.exports = { __esModule: true, ${lines.join(",\n")} };\n`;
}

export type LayerOptions = {
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
  // false なら 1 つのファイルにまとめる（クエリ付きの import で評価し直すと、モジュールの状態ごと新しくなる）
  splitting?: boolean;
};

let builds = 0;
export type Layer = "rsc" | "ssr" | "browser";

export async function buildLayer(layer: Layer, entries: string[], { define, generatedDir, transform, nativeDir, redirect, aliases: override, splitting = true }: LayerOptions) {
  const aliases: Record<string, string> = ALIASES[layer];
  const bundledAliases = Object.fromEntries(
    Object.entries({ ...BUNDLED_ALIASES[layer], ...override }).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const outdir = join(tmpdir(), `proofyard-next-${process.pid}-${layer}-${builds++}`);
  const entryPaths = entries.map((e) => (e.startsWith("/") ? e : abs(e)));
  const result = await Bun.build({
    entrypoints: entryPaths,
    outdir,
    target: layer === "browser" ? "browser" : "bun",
    format: "esm",
    conditions: layer === "rsc" ? ["react-server"] : layer === "browser" ? ["browser"] : [],
    splitting,
    naming: "[dir]/[name]-[hash].[ext]",
    root: "/",
    // define の NODE_ENV と揃える（prod の React に jsxDEV はない）
    jsx: { development: define["process.env.NODE_ENV"] === '"development"' },
    define,
    plugins: [
      {
        name: `next-${layer}-layer`,
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in aliases) return { path: abs(aliases[args.path]!), external: true };
            const shared = layer !== "browser" && args.path.match(/\.\/(?:.+\/)?([^/]+)\.shared-runtime$/);
            if (shared) return { path: abs(`${VENDORED}/contexts/${shared[1]}`), external: true };
            if (args.path in bundledAliases) return { path: abs(bundledAliases[args.path]!) };
            if (args.path.startsWith("node:") || !args.importer) return;
            const generated = generatedDir !== undefined && args.importer.startsWith(generatedDir);
            let resolved: string;
            try {
              resolved = Bun.resolveSync(args.path, generated ? root : dirname(args.importer));
            } catch {
              // 解決できない任意依存（開発専用など）は外部にし、実行時に到達したときだけ失敗させる
              return { path: args.path, external: true };
            }
            if (/\.external(\.js)?$/.test(resolved) || /module\.compiled(\.js)?$/.test(resolved)) return { path: resolved, external: true };
            if (nativeDir !== undefined && resolved.startsWith(nativeDir + "/") && !resolved.includes("/node_modules/"))
              return { path: resolved, external: true };
            const redirected = redirect?.(resolved);
            if (redirected) return { path: redirected };
            if (generated) return { path: resolved };
          });
          if (layer === "rsc") {
            // node_modules の JS とアプリのソース（"use client" は Client Reference に、それ以外のアプリのソースは SWC に）
            build.onLoad({ filter: /\.(?:[cm]?js|jsx|tsx?)$/ }, async (args) => {
              const inNodeModules = args.path.includes("/node_modules/");
              if (inNodeModules && !/\.[cm]?js$/.test(args.path)) return;
              const source = readFileSync(args.path, "utf8");
              if (USE_CLIENT.test(source)) return { loader: "js", contents: clientReferenceStub(args.path, source) };
              if (inNodeModules) {
                if (SERVER_DIRECTIVE.test(source))
                  throw new Error(`Unsupported Next.js feature: "use server" / "use cache" in node_modules is not compiled by the current runtime (${args.path})`);
                return;
              }
              const code = await transform?.(args.path, source);
              if (code !== undefined) return { loader: "js", contents: code };
            });
          } else if (transform) {
            build.onLoad({ filter: /\.(?:[cm]?js|jsx|tsx?)$/ }, async (args) => {
              if (args.path.includes("/node_modules/")) return;
              const code = await transform(args.path, readFileSync(args.path, "utf8"));
              if (code !== undefined) return { loader: "js", contents: code };
            });
          }
        },
      },
    ],
  });
  if (!result.success) throw new AggregateError(result.logs, `${layer} layer build failed`);
  // 入口ごとの出力（[dir] を保つので入口の絶対パスから引ける）
  const out = new Map<string, string>();
  for (const entry of entryPaths) {
    const stem = entry.replace(/\.[cm]?[jt]sx?$/, "");
    const o = result.outputs.find((x) => x.kind === "entry-point" && x.path.startsWith(join(outdir, stem) + "-"));
    if (!o) throw new Error(`no output for ${entry}`);
    out.set(entry, o.path);
  }
  return out;
}
