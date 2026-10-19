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

const root = process.cwd();
const abs = (spec: string) => Bun.resolveSync(spec, root);
const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:["']use strict["'];?\s*)?["']use client["']/;

// Client Reference の id（node_modules 内の "use client" ファイルの絶対パス）
export const clientIds = new Set<string>();

function clientReferenceStub(path: string, source: string) {
  clientIds.add(path);
  // ponytail: export 名を正規表現で拾う（CJS の exports.X = / Object.defineProperty(exports, "X") / _export(exports, { X: ... })）
  const names = new Set<string>();
  for (const m of source.matchAll(/(?:exports\.([A-Za-z_$][\w$]*)\s*=|defineProperty\(exports,\s*["']([A-Za-z_$][\w$]*)["'])/g)) names.add(m[1] ?? m[2]!);
  const exportBlock = source.match(/_export\(exports,\s*\{([\s\S]*?)\}\);/);
  if (exportBlock) for (const m of exportBlock[1]!.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) names.add(m[1]!);
  names.delete("__esModule");
  const id = JSON.stringify(path);
  const lines = [...names].map(
    (n) => `${JSON.stringify(n)}: registerClientReference(function () { throw new Error("[proofyard] client function called on the server"); }, ${id}, ${JSON.stringify(n)})`,
  );
  return `import { registerClientReference } from "react-server-dom-webpack/server";\nmodule.exports = { __esModule: true, ${lines.join(",\n")} };\n`;
}

export async function buildLayer(layer: "rsc" | "ssr", entries: string[]) {
  const aliases: Record<string, string> = ALIASES[layer];
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
    // Next.js のビルド（define-env.ts）同様、環境で決まる分岐を畳む（開発専用のコードを引き込まない）
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
      "process.env.NEXT_RUNTIME": JSON.stringify("nodejs"),
      "process.env.TURBOPACK": "undefined",
      "process.env.__NEXT_EXPERIMENTAL_REACT": "undefined",
      "process.env.__NEXT_USE_NODE_STREAMS": "true",
      // ponytail: define は手書き。next/dist/build/define-env の getDefineEnv を再利用する形にする
    },
    plugins: [
      {
        name: `next-${layer}-layer`,
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in aliases) return { path: abs(aliases[args.path]!), external: true };
            const shared = args.path.match(/\.\/(?:.+\/)?([^/]+)\.shared-runtime$/);
            if (shared) return { path: abs(`${VENDORED}/contexts/${shared[1]}`), external: true };
            if (args.path.startsWith("node:") || !args.importer) return;
            let resolved: string;
            try {
              resolved = Bun.resolveSync(args.path, dirname(args.importer));
            } catch {
              // 解決できない任意依存（開発専用など）は外部にし、実行時に到達したときだけ失敗させる
              return { path: args.path, external: true };
            }
            if (/\.external(\.js)?$/.test(resolved) || /module\.compiled(\.js)?$/.test(resolved)) return { path: resolved, external: true };
          });
          if (layer === "rsc") {
            build.onLoad({ filter: /\/node_modules\/.*\.[cm]?js$/ }, (args) => {
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
