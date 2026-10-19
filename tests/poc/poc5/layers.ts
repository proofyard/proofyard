// Next.js のビルドの層（nodejs 環境）を Bun.build で再現する（node_modules 側だけ）。
//   rsc: react-server 層。"use client" は Client Reference に置き換える
//   ssr: SSR 層。Client Component の実装を SSR 用の React で読む
// 共通:
// - react 系は Next.js の runtime バンドル内の React（vendored/rsc, vendored/ssr）へ（create-compiler-aliases.ts）
// - *.shared-runtime は app-page 用の vendored/contexts へ（webpack-config.ts の NormalModuleReplacementPlugin）
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
    "react-server-dom-webpack/client": "next/dist/compiled/react-server-dom-webpack/client.node",
    "server-only": "next/dist/compiled/server-only/empty",
    "client-only": "next/dist/compiled/client-only/error",
    "@opentelemetry/api": "next/dist/compiled/@opentelemetry/api",
  },
  ssr: {
    ...reactAliases("ssr"),
    "react-dom/server": "next/dist/compiled/react-dom/server.node",
    "react-server-dom-webpack/client": `${VENDORED}/ssr/react-server-dom-webpack-client`,
    "server-only": "next/dist/compiled/server-only/error",
    "client-only": "next/dist/compiled/client-only/index",
    "@opentelemetry/api": "next/dist/compiled/@opentelemetry/api",
  },
} as const;
// next/navigation などは層ごとに別実装（create-compiler-aliases.ts の createAppRouterApiAliases）。外部にせず層のバンドルに含める
const APP_ROUTER_ALIASES = {
  rsc: {
    "next/navigation": "next/dist/api/navigation.react-server",
    "next/error": "next/dist/api/error.react-server",
    "next/link": "next/dist/client/app-dir/link.react-server",
    "next/head": "next/dist/client/components/noop-head",
    "next/dynamic": "next/dist/api/app-dynamic",
    "next/form": "next/dist/client/app-dir/form",
  },
  ssr: {
    "next/link": "next/dist/client/app-dir/link",
    "next/head": "next/dist/client/components/noop-head",
    "next/dynamic": "next/dist/api/app-dynamic",
    "next/form": "next/dist/client/app-dir/form",
  },
} as const;

const root = process.cwd();
const abs = (spec: string) => Bun.resolveSync(spec, root);
const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:["']use strict["'];?\s*)?["']use client["']/;

// Client Reference の id（"use client" ファイルの絶対パス）。esmClientIds は ESM（名前空間で渡す）もの
export const clientIds = new Set<string>();
export const esmClientIds = new Set<string>();

const registerStub = (id: string, n: string) =>
  `registerClientReference(function () { throw new Error("[proofyard] client function called on the server"); }, ${id}, ${JSON.stringify(n)})`;

function clientReferenceStub(path: string, source: string) {
  clientIds.add(path);
  const id = JSON.stringify(path);
  const loader = path.match(/\.([jt]sx?)$/)?.[1] as "js" | "jsx" | "ts" | "tsx" | undefined;
  const esmExports = new Bun.Transpiler({ loader: loader ?? "js" }).scan(source).exports;
  if (esmExports.length) {
    esmClientIds.add(path);
    const lines = esmExports.map((n) => (n === "default" ? `export default ${registerStub(id, n)};` : `export const ${n} = ${registerStub(id, n)};`));
    return `import { registerClientReference } from "react-server-dom-webpack/server";\n${lines.join("\n")}\n`;
  }
  // ponytail: export 名を正規表現で拾う（CJS の exports.X = / Object.defineProperty(exports, "X") / _export(exports, { X: ... })）
  const names = new Set<string>();
  for (const m of source.matchAll(/(?:exports\.([A-Za-z_$][\w$]*)\s*=|defineProperty\(exports,\s*["']([A-Za-z_$][\w$]*)["'])/g)) names.add(m[1] ?? m[2]!);
  const exportBlock = source.match(/_export\(exports,\s*\{([\s\S]*?)\}\);/);
  if (exportBlock) for (const m of exportBlock[1]!.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) names.add(m[1]!);
  names.delete("__esModule");
  const lines = [...names].map((n) => `${JSON.stringify(n)}: ${registerStub(id, n)}`);
  return `import { registerClientReference } from "react-server-dom-webpack/server";\nmodule.exports = { __esModule: true, ${lines.join(",\n")} };\n`;
}

// define: Next.js の getDefineEnv の結果（環境で決まる分岐を next build と同じく畳む）
// generatedDir: next-app-loader が生成したエントリの置き場所。そこからの import はプロジェクトルートから解決する
export async function buildLayer(layer: "rsc" | "ssr", entries: string[], define: Record<string, string>, generatedDir?: string) {
  const aliases: Record<string, string> = ALIASES[layer];
  const appRouterAliases: Record<string, string> = APP_ROUTER_ALIASES[layer];
  const outdir = join(tmpdir(), `proofyard-next-${layer}-${process.pid}`);
  const entryPaths = entries.map((e) => (e.startsWith("/") ? e : abs(e)));
  const result = await Bun.build({
    entrypoints: entryPaths,
    outdir,
    target: "bun",
    format: "esm",
    conditions: layer === "rsc" ? ["react-server"] : [],
    splitting: true,
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
            const shared = args.path.match(/\.\/(?:.+\/)?([^/]+)\.shared-runtime$/);
            if (shared) return { path: abs(`${VENDORED}/contexts/${shared[1]}`), external: true };
            if (args.path in appRouterAliases) return { path: abs(appRouterAliases[args.path]!) };
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
            if (generated) return { path: resolved };
          });
          if (layer === "rsc") {
            // node_modules の JS とアプリのソース（"use client" は Client Reference に）
            build.onLoad({ filter: /\.(?:[cm]?js|jsx|tsx?)$/ }, (args) => {
              if (args.path.includes("/node_modules/") && !/\.[cm]?js$/.test(args.path)) return;
              const source = readFileSync(args.path, "utf8");
              if (USE_CLIENT.test(source)) return { loader: "js", contents: clientReferenceStub(args.path, source) };
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
